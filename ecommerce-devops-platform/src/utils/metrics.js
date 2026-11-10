'use strict';

const client = require('prom-client');
const mongoose = require('mongoose');

/**
 * Prometheus metrics on a dedicated registry, which keeps tests isolated and
 * makes it explicit what this service exports.
 */
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'ecommerce_' });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests handled, by method, route template and status code',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const ordersCreatedTotal = new client.Counter({
  name: 'orders_created_total',
  help: 'Orders successfully created',
  registers: [register],
});

const orderIdempotentReplaysTotal = new client.Counter({
  name: 'order_idempotent_replays_total',
  help: 'Checkout requests answered from an existing order (same Idempotency-Key)',
  registers: [register],
});

const orderRejectionsTotal = new client.Counter({
  name: 'order_rejections_total',
  help: 'Checkout requests rejected, by reason',
  labelNames: ['reason'],
  registers: [register],
});

// Evaluated on every scrape, so the value is always current.
new client.Gauge({
  name: 'app_mongodb_up',
  help: '1 if the application is connected to MongoDB, otherwise 0',
  registers: [register],
  collect() {
    this.set(mongoose.connection.readyState === 1 ? 1 : 0);
  },
});

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  ordersCreatedTotal,
  orderIdempotentReplaysTotal,
  orderRejectionsTotal,
};
