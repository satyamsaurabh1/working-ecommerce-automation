'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const schemas = require('../validators/schemas');
const products = require('../controllers/product-controller');
const orders = require('../controllers/order-controller');
const admin = require('../controllers/admin-controller');
const auth = require('../controllers/auth-controller');
const health = require('../controllers/health-controller');

function buildRouter(config) {
  const router = express.Router();

  // Operational endpoints
  router.get('/health', health.health(config));
  router.get('/ready', health.ready);
  router.get('/metrics', health.metrics); // blocked at Nginx; scraped by Prometheus on the internal network

  const api = express.Router();

  // Public catalogue and checkout
  api.get('/products', validate({ query: schemas.listProductsQuery }), products.list);
  api.get('/products/:id', validate({ params: schemas.idParam }), products.getById);
  api.post('/orders', validate({ body: schemas.createOrderBody }), orders.create);
  api.get('/orders/:id', validate({ params: schemas.idParam }), orders.getById);
  api.get('/orders/:id/status', validate({ params: schemas.idParam }), orders.getStatus);

  // Authentication (rate limited against brute force)
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts, try again later' } },
  });
  api.post('/auth/login', loginLimiter, validate({ body: schemas.loginBody }), auth.login(config));

  // Admin: every route requires a valid token AND the admin role
  const adminRouter = express.Router();
  adminRouter.use(requireAuth(config), requireRole('admin'));
  adminRouter.post('/products', validate({ body: schemas.createProductBody }), admin.createProduct);
  adminRouter.patch('/products/:id', validate({ params: schemas.idParam, body: schemas.updateProductBody }), admin.updateProduct);
  adminRouter.patch('/products/:id/stock', validate({ params: schemas.idParam, body: schemas.updateStockBody }), admin.updateStock);
  adminRouter.patch('/orders/:id/status', validate({ params: schemas.idParam, body: schemas.updateOrderStatusBody }), admin.updateOrderStatus);
  adminRouter.get('/audit-events', validate({ query: schemas.listAuditQuery }), admin.listAuditEvents);
  api.use('/admin', adminRouter);

  router.use('/api/v1', api);
  return router;
}

module.exports = { buildRouter };
