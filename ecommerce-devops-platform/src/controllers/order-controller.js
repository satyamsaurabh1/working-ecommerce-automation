'use strict';

const orderService = require('../services/order-service');
const schemas = require('../validators/schemas');
const { badRequest } = require('../utils/errors');

async function create(req, res) {
  const key = schemas.idempotencyKey.safeParse(req.get('idempotency-key'));
  if (!key.success) throw badRequest(key.error.issues[0].message);

  const { order, replayed } = await orderService.createOrder({ idempotencyKey: key.data, body: req.valid.body });
  res.set('Idempotent-Replayed', String(replayed));
  // 201 for a new order; 200 for a replay of an order that already exists.
  res.status(replayed ? 200 : 201).json(order);
}

const getById = async (req, res) => res.json(await orderService.getOrder(req.valid.params.id));
const getStatus = async (req, res) => res.json(await orderService.getOrderStatus(req.valid.params.id));

module.exports = { create, getById, getStatus };
