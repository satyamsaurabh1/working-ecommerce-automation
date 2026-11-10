'use strict';

const mongoose = require('mongoose');
const { Product, Order, AuditEvent, STATUS_TRANSITIONS } = require('../models');
const { AppError, notFound, conflict } = require('../utils/errors');
const { hashRequest } = require('../utils/request-hash');
const metrics = require('../utils/metrics');
const { toOrder } = require('./serializers');

/**
 * Returns the stored order for a repeated Idempotency-Key, but only if the
 * request body is identical. Reusing a key for a different order is a client bug.
 */
function replay(existing, requestHash) {
  if (existing.requestHash !== requestHash) {
    metrics.orderRejectionsTotal.inc({ reason: 'idempotency_key_reused' });
    throw conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with a different request body',
    );
  }
  metrics.orderIdempotentReplaysTotal.inc();
  return { order: toOrder(existing), replayed: true };
}

/** Same product listed twice in one order -> one line with the summed quantity. */
function mergeItems(items) {
  const merged = new Map();
  for (const { productId, quantity } of items) {
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }
  return merged;
}

/**
 * Checkout. Three mechanisms work together:
 *  1. Idempotency: a unique index on idempotencyKey means a second order with
 *     the same key can never be inserted, even if two requests race.
 *  2. Atomic stock check: `stock >= qty` and `$inc: -qty` are one operation,
 *     so stock can never go negative.
 *  3. A multi-document transaction: all stock decrements and the order insert
 *     commit together or not at all (no half-placed orders).
 */
async function createOrder({ idempotencyKey, body }) {
  const requestHash = hashRequest(body);

  const existing = await Order.findOne({ idempotencyKey }).lean();
  if (existing) return replay(existing, requestHash);

  const quantities = mergeItems(body.items);
  const session = await mongoose.startSession();
  try {
    let created;
    // withTransaction retries automatically on transient write conflicts.
    await session.withTransaction(async () => {
      const items = [];
      for (const [productId, quantity] of quantities) {
        const before = await Product.findOneAndUpdate(
          { _id: productId, active: true, stock: { $gte: quantity } },
          { $inc: { stock: -quantity } },
          { session, returnDocument: 'before', lean: true },
        );
        if (!before) {
          const product = await Product.findById(productId).session(session).lean();
          if (!product || !product.active) {
            metrics.orderRejectionsTotal.inc({ reason: 'product_not_found' });
            throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found or unavailable', { productId });
          }
          metrics.orderRejectionsTotal.inc({ reason: 'insufficient_stock' });
          throw conflict('INSUFFICIENT_STOCK', `Insufficient stock for ${product.sku}`, {
            productId,
            requested: quantity,
            available: product.stock,
          });
        }
        items.push({
          productId: before._id,
          sku: before.sku,
          name: before.name,
          unitPrice: before.price,
          quantity,
          lineTotal: before.price * quantity,
          stockAtCheckout: before.stock,
          stockAfterCheckout: before.stock - quantity,
        });
      }

      const totalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
      [created] = await Order.create(
        [
          {
            idempotencyKey,
            requestHash,
            customer: body.customer,
            items,
            totalAmount,
            status: 'CONFIRMED',
            statusHistory: [{ status: 'CONFIRMED', by: 'customer' }],
          },
        ],
        { session },
      );
    });

    metrics.ordersCreatedTotal.inc();
    return { order: toOrder(created.toObject()), replayed: false };
  } catch (err) {
    // Lost a race with an identical concurrent request: its order won, ours was rolled back.
    if (err?.code === 11000 && err?.keyPattern?.idempotencyKey) {
      const winner = await Order.findOne({ idempotencyKey }).lean();
      if (winner) return replay(winner, requestHash);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

async function getOrder(id) {
  const order = await Order.findById(id).lean();
  if (!order) throw notFound('Order not found');
  return toOrder(order);
}

async function getOrderStatus(id) {
  const order = await Order.findById(id, { status: 1, statusHistory: 1, updatedAt: 1 }).lean();
  if (!order) throw notFound('Order not found');
  return { orderId: String(order._id), status: order.status, history: order.statusHistory, updatedAt: order.updatedAt };
}

/** Admin status change. Cancelling restores stock in the same transaction. */
async function updateOrderStatus({ id, status, reason, actor, requestId }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order) throw notFound('Order not found');
      if (!STATUS_TRANSITIONS[order.status].includes(status)) {
        throw conflict('INVALID_STATUS_TRANSITION', `Cannot change status from ${order.status} to ${status}`);
      }
      const previous = order.status;

      if (status === 'CANCELLED') {
        for (const item of order.items) {
          await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } }, { session });
        }
      }

      order.status = status;
      order.statusHistory.push({ status, by: actor });
      await order.save({ session });
      await AuditEvent.create(
        [
          {
            actor,
            action: 'ORDER_STATUS_UPDATED',
            entityType: 'order',
            entityId: String(order._id),
            before: { status: previous },
            after: { status, stockRestored: status === 'CANCELLED' },
            reason,
            requestId,
          },
        ],
        { session },
      );
      result = toOrder(order.toObject());
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { createOrder, getOrder, getOrderStatus, updateOrderStatus };
