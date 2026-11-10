'use strict';

const { setupTestApp, seedCatalogue, signToken, newKey } = require('../helpers/test-app');
const { Product, AuditEvent, AdminUser } = require('../../src/models');
const { hashPassword } = require('../../src/services/auth-service');

const ctx = setupTestApp('admin');
let product;
let token;

beforeEach(async () => {
  await seedCatalogue();
  product = await Product.findOne({ sku: 'MS-WL-02' }).lean(); // stock 75, price 129900
  token = signToken(ctx.config);
});

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

describe('admin authentication', () => {
  beforeEach(async () => {
    await AdminUser.create({ username: 'opsadmin', passwordHash: await hashPassword('correct-horse-battery') });
  });

  test('valid credentials return a JWT that unlocks admin routes', async () => {
    const res = await ctx.request.post('/api/v1/auth/login')
      .send({ username: 'OpsAdmin', password: 'correct-horse-battery' }).expect(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: '1h' });
    await ctx.request.get('/api/v1/admin/audit-events').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  });

  test('wrong password and unknown user return the same 401', async () => {
    const a = await ctx.request.post('/api/v1/auth/login').send({ username: 'opsadmin', password: 'wrong-password' }).expect(401);
    const b = await ctx.request.post('/api/v1/auth/login').send({ username: 'ghost', password: 'wrong-password' }).expect(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  test('passwords are stored as bcrypt hashes', async () => {
    const user = await AdminUser.findOne({ username: 'opsadmin' }).lean();
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain('correct-horse');
  });

  test('login is rate limited', async () => {
    const attempts = [];
    for (let i = 0; i < 6; i += 1) {
      attempts.push(await ctx.request.post('/api/v1/auth/login').send({ username: 'x', password: 'y' }));
    }
    expect(attempts.at(-1).status).toBe(429);
  });
});

describe('admin authorization', () => {
  const path = () => `/api/v1/admin/products/${product._id}`;

  test('no token -> 401', async () => {
    await ctx.request.patch(path()).send({ price: 1 }).expect(401);
  });

  test('tampered, expired or wrong-secret token -> 401', async () => {
    await ctx.request.patch(path()).set('Authorization', `Bearer ${token}x`).send({ price: 1 }).expect(401);
    const expired = signToken(ctx.config, { expiresIn: '-1s' });
    await ctx.request.patch(path()).set('Authorization', `Bearer ${expired}`).send({ price: 1 }).expect(401);
    const forged = signToken({ JWT_SECRET: 'a-different-secret-that-is-32-chars!!' });
    await ctx.request.patch(path()).set('Authorization', `Bearer ${forged}`).send({ price: 1 }).expect(401);
  });

  test('authenticated but not an admin -> 403', async () => {
    const viewer = signToken(ctx.config, { role: 'viewer' });
    await ctx.request.patch(path()).set('Authorization', `Bearer ${viewer}`).send({ price: 1 }).expect(403);
    expect((await Product.findById(product._id).lean()).price).toBe(129900);
  });
});

describe('admin product and stock updates with audit events', () => {
  test('updating a product records before/after in an audit event', async () => {
    const res = await auth(ctx.request.patch(`/api/v1/admin/products/${product._id}`))
      .set('X-Request-Id', 'req-update-price-1').send({ price: 119900, name: 'Wireless Mouse v2' }).expect(200);
    expect(res.body).toMatchObject({ price: 119900, name: 'Wireless Mouse v2' });

    const [event] = await AuditEvent.find({ entityId: String(product._id) }).lean();
    expect(event).toMatchObject({
      actor: 'admin', action: 'PRODUCT_UPDATED', entityType: 'product', requestId: 'req-update-price-1',
      before: { price: 129900, name: 'Wireless Mouse' }, after: { price: 119900, name: 'Wireless Mouse v2' },
    });
  });

  test('stock cannot be edited through the product endpoint', async () => {
    await auth(ctx.request.patch(`/api/v1/admin/products/${product._id}`)).send({ stock: 5 }).expect(400);
  });

  test('stock "set" and "adjust" operations are audited with a reason', async () => {
    await auth(ctx.request.patch(`/api/v1/admin/products/${product._id}/stock`))
      .send({ operation: 'set', quantity: 10, reason: 'cycle count' }).expect(200);
    const res = await auth(ctx.request.patch(`/api/v1/admin/products/${product._id}/stock`))
      .send({ operation: 'adjust', delta: -4, reason: 'damaged units' }).expect(200);
    expect(res.body.stock).toBe(6);

    const events = await auth(ctx.request.get(`/api/v1/admin/audit-events?entityId=${product._id}`)).expect(200);
    expect(events.body.data.map((e) => [e.before.stock, e.after.stock, e.reason])).toEqual([
      [10, 6, 'damaged units'],
      [75, 10, 'cycle count'],
    ]);
  });

  test('a stock adjustment below zero is rejected with 409 and no audit event', async () => {
    const res = await auth(ctx.request.patch(`/api/v1/admin/products/${product._id}/stock`))
      .send({ operation: 'adjust', delta: -76, reason: 'too many' }).expect(409);
    expect(res.body.error.code).toBe('NEGATIVE_STOCK');
    expect((await Product.findById(product._id).lean()).stock).toBe(75);
    expect(await AuditEvent.countDocuments()).toBe(0);
  });

  test('stock updates require a reason and a valid operation', async () => {
    const url = `/api/v1/admin/products/${product._id}/stock`;
    await auth(ctx.request.patch(url)).send({ operation: 'set', quantity: 5 }).expect(400);
    await auth(ctx.request.patch(url)).send({ operation: 'set', quantity: -1, reason: 'oops' }).expect(400);
    await auth(ctx.request.patch(url)).send({ operation: 'multiply', quantity: 2, reason: 'nope' }).expect(400);
  });

  test('creating a product is audited; a duplicate SKU returns 409', async () => {
    const body = { sku: 'CB-USB-09', name: 'USB-C Cable', category: 'accessories', price: 49900, stock: 100 };
    const res = await auth(ctx.request.post('/api/v1/admin/products')).send(body).expect(201);
    expect(res.body.sku).toBe('CB-USB-09');
    expect(await AuditEvent.countDocuments({ action: 'PRODUCT_CREATED', entityId: res.body.id })).toBe(1);
    const dup = await auth(ctx.request.post('/api/v1/admin/products')).send(body).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_SKU');
  });

  test('admin updates on an unknown product -> 404', async () => {
    await auth(ctx.request.patch('/api/v1/admin/products/0123456789abcdef01234567')).send({ price: 1 }).expect(404);
    await auth(ctx.request.patch('/api/v1/admin/products/0123456789abcdef01234567/stock'))
      .send({ operation: 'set', quantity: 1, reason: 'test' }).expect(404);
  });
});

describe('admin order status transitions', () => {
  const placeOrder = () => ctx.request.post('/api/v1/orders').set('Idempotency-Key', newKey())
    .send({ customer: { name: 'Ravi', email: 'ravi@example.com' }, items: [{ productId: String(product._id), quantity: 5 }] })
    .expect(201);

  test('CONFIRMED -> SHIPPED -> DELIVERED; invalid transitions are rejected', async () => {
    const order = await placeOrder();
    const url = `/api/v1/admin/orders/${order.body.id}/status`;
    await auth(ctx.request.patch(url)).send({ status: 'DELIVERED' }).expect(409);
    await auth(ctx.request.patch(url)).send({ status: 'SHIPPED' }).expect(200);
    const done = await auth(ctx.request.patch(url)).send({ status: 'DELIVERED' }).expect(200);
    expect(done.body.statusHistory.map((h) => h.status)).toEqual(['CONFIRMED', 'SHIPPED', 'DELIVERED']);
    await auth(ctx.request.patch(url)).send({ status: 'CANCELLED' }).expect(409);
  });

  test('cancelling a confirmed order restores stock and is audited', async () => {
    const order = await placeOrder();
    expect((await Product.findById(product._id).lean()).stock).toBe(70);
    await auth(ctx.request.patch(`/api/v1/admin/orders/${order.body.id}/status`))
      .send({ status: 'CANCELLED', reason: 'customer request' }).expect(200);
    expect((await Product.findById(product._id).lean()).stock).toBe(75);
    expect(await AuditEvent.countDocuments({ action: 'ORDER_STATUS_UPDATED', entityId: order.body.id })).toBe(1);
  });
});
