'use strict';

const mongoose = require('mongoose');

const ORDER_STATUSES = ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

/** Allowed status transitions (a small state machine). */
const STATUS_TRANSITIONS = {
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Each line is a snapshot: later price or stock changes never alter past orders. */
const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
    stockAtCheckout: { type: Number, required: true },
    stockAfterCheckout: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    // The unique index is what makes duplicate orders impossible, even under concurrency.
    idempotencyKey: { type: String, required: true, unique: true },
    requestHash: { type: String, required: true },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true },
    },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ORDER_STATUSES, default: 'CONFIRMED' },
    statusHistory: [
      { _id: false, status: String, at: { type: Date, default: Date.now }, by: String },
    ],
  },
  { timestamps: true, versionKey: false },
);

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

module.exports = { Order, ORDER_STATUSES, STATUS_TRANSITIONS };
