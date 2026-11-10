'use strict';

const adminProducts = require('../services/admin-product-service');
const orderService = require('../services/order-service');

const ctx = (req) => ({ actor: req.user.username, requestId: req.id });

const createProduct = async (req, res) =>
  res.status(201).json(await adminProducts.createProduct({ data: req.valid.body, ...ctx(req) }));

const updateProduct = async (req, res) =>
  res.json(await adminProducts.updateProduct({ id: req.valid.params.id, changes: req.valid.body, ...ctx(req) }));

const updateStock = async (req, res) =>
  res.json(await adminProducts.updateStock({ id: req.valid.params.id, body: req.valid.body, ...ctx(req) }));

const updateOrderStatus = async (req, res) =>
  res.json(await orderService.updateOrderStatus({ id: req.valid.params.id, ...req.valid.body, ...ctx(req) }));

const listAuditEvents = async (req, res) => res.json({ data: await adminProducts.listAuditEvents(req.valid.query) });

module.exports = { createProduct, updateProduct, updateStock, updateOrderStatus, listAuditEvents };
