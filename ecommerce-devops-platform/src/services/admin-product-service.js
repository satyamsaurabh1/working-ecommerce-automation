'use strict';

const mongoose = require('mongoose');
const { Product, AuditEvent } = require('../models');
const { notFound, conflict } = require('../utils/errors');
const { toProduct, toAuditEvent } = require('./serializers');

/** Runs a change and its audit event in one transaction: no change without an audit record. */
async function withAudit(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function audit(session, { actor, action, product, before, after, reason, requestId }) {
  return AuditEvent.create(
    [{ actor, action, entityType: 'product', entityId: String(product._id), before, after, reason, requestId }],
    { session },
  );
}

async function createProduct({ data, actor, requestId }) {
  try {
    return await withAudit(async (session) => {
      const [product] = await Product.create([data], { session });
      const after = product.toObject();
      await audit(session, { actor, action: 'PRODUCT_CREATED', product, before: null, after, requestId });
      return toProduct(after);
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict('DUPLICATE_SKU', `A product with SKU ${data.sku} already exists`);
    throw err;
  }
}

async function updateProduct({ id, changes, actor, requestId }) {
  return withAudit(async (session) => {
    const before = await Product.findOneAndUpdate({ _id: id }, { $set: changes }, {
      session, returnDocument: 'before', runValidators: true, lean: true,
    });
    if (!before) throw notFound('Product not found');
    const beforeFields = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]]));
    await audit(session, { actor, action: 'PRODUCT_UPDATED', product: before, before: beforeFields, after: changes, requestId });
    return toProduct({ ...before, ...changes });
  });
}

/**
 * Stock update. "set" replaces the value; "adjust" adds a delta. A negative
 * adjustment only applies if enough stock exists, so inventory cannot go below zero.
 */
async function updateStock({ id, body, actor, requestId }) {
  return withAudit(async (session) => {
    const filter = { _id: id };
    let update;
    if (body.operation === 'set') {
      update = { $set: { stock: body.quantity } };
    } else {
      update = { $inc: { stock: body.delta } };
      if (body.delta < 0) filter.stock = { $gte: -body.delta };
    }

    const before = await Product.findOneAndUpdate(filter, update, { session, returnDocument: 'before', lean: true });
    if (!before) {
      const exists = await Product.exists({ _id: id }).session(session);
      if (!exists) throw notFound('Product not found');
      throw conflict('NEGATIVE_STOCK', 'Adjustment would make stock negative');
    }

    const newStock = body.operation === 'set' ? body.quantity : before.stock + body.delta;
    await audit(session, {
      actor,
      action: 'STOCK_UPDATED',
      product: before,
      before: { stock: before.stock },
      after: { stock: newStock, operation: body.operation, ...(body.delta !== undefined && { delta: body.delta }) },
      reason: body.reason,
      requestId,
    });
    return toProduct({ ...before, stock: newStock });
  });
}

async function listAuditEvents({ entityId, action, limit }) {
  const filter = {};
  if (entityId) filter.entityId = entityId;
  if (action) filter.action = action;
  const events = await AuditEvent.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return events.map(toAuditEvent);
}

module.exports = { createProduct, updateProduct, updateStock, listAuditEvents };
