'use strict';

const { setupTestApp, seedCatalogue, newKey } = require('../helpers/test-app');
const { Product, Order } = require('../../src/models');

const ctx = setupTestApp('orders');

const customer = { name: 'Asha Verma', email: 'asha@example.com' };
let keyboard; // stock 40, price 449900
let monitor; //  stock 12, price 1849900

const checkout = (body, key = newKey()) => ctx.request.post('/api/v1/orders').set('Idempotency-Key', key).send(body);
const stockOf = async (doc) => (await Product.findById(doc._id).lean()).stock;

beforeEach(async () => {
  await seedCatalogue();
  keyboard = await Product.findOne({ sku: 'KB-MECH-01' }).lean();
  monitor = await Product.findOne({ sku: 'MN-27-04' }).lean();
});

describe('checkout', () => {
  test('creates an order with total, price snapshot and stock snapshot', async () => {
    const res = await checkout({
      customer,
      items: [
        { productId: String(keyboard._id), quantity: 2 },
        { productId: String(monitor._id), quantity: 1 },
      ],
    }).expect(201);

    expect(res.headers['idempotent-replayed']).toBe('false');
    expect(res.body).toMatchObject({ status: 'CONFIRMED', totalAmount: 2 * 449900 + 1849900, currency: 'INR' });
    expect(res.body.items[0]).toMatchObject({
      sku: 'KB-MECH-01', unitPrice: 449900, quantity: 2, lineTotal: 899800, stockAtCheckout: 40, stockAfterCheckout: 38,
    });
    expect(res.body.requestHash).toBeUndefined();
    expect(await stockOf(keyboard)).toBe(38);
    expect(await stockOf(monitor)).toBe(11);
  });

  test('the price snapshot does not change when the product price changes later', async () => {
    const res = await checkout({ customer, items: [{ productId: String(keyboard._id), quantity: 1 }] }).expect(201);
    await Product.updateOne({ _id: keyboard._id }, { price: 1 });
    const order = await ctx.request.get(`/api/v1/orders/${res.body.id}`).expect(200);
    expect(order.body.items[0].unitPrice).toBe(449900);
  });

  test('duplicate lines for the same product are merged', async () => {
    const res = await checkout({
      customer,
      items: [{ productId: String(keyboard._id), quantity: 1 }, { productId: String(keyboard._id), quantity: 2 }],
    }).expect(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe(3);
    expect(await stockOf(keyboard)).toBe(37);
  });

  test('rejects quantity above available stock with 409 and deducts nothing', async () => {
    const res = await checkout({ customer, items: [{ productId: String(monitor._id), quantity: 13 }] }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { requested: 13, available: 12 } });
    expect(await stockOf(monitor)).toBe(12);
    expect(await Order.countDocuments()).toBe(0);
  });

  test('is atomic: if any line fails, earlier lines are rolled back', async () => {
    await checkout({
      customer,
      items: [{ productId: String(keyboard._id), quantity: 5 }, { productId: String(monitor._id), quantity: 50 }], // valid, but > 12 in stock
    }).expect(409);
    expect(await stockOf(keyboard)).toBe(40); // not 35
    expect(await Order.countDocuments()).toBe(0);
  });

  test('unknown or inactive product -> 404', async () => {
    await checkout({ customer, items: [{ productId: '0123456789abcdef01234567', quantity: 1 }] }).expect(404);
    await Product.updateOne({ _id: keyboard._id }, { active: false });
    const res = await checkout({ customer, items: [{ productId: String(keyboard._id), quantity: 1 }] }).expect(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  test.each([
    ['zero quantity', { quantity: 0 }],
    ['negative quantity', { quantity: -3 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['string quantity', { quantity: '2' }],
    ['operator injection', { quantity: { $gt: 0 } }],
  ])('rejects %s with 400', async (_label, override) => {
    await checkout({ customer, items: [{ productId: String(keyboard._id), ...override }] }).expect(400);
    expect(await stockOf(keyboard)).toBe(40);
  });

  test('rejects missing customer, empty items, unknown fields and invalid JSON', async () => {
    await checkout({ items: [{ productId: String(keyboard._id), quantity: 1 }] }).expect(400);
    await checkout({ customer, items: [] }).expect(400);
    await checkout({ customer, items: [{ productId: String(keyboard._id), quantity: 1 }], discount: 100 }).expect(400);
    const res = await ctx.request.post('/api/v1/orders').set('Idempotency-Key', newKey())
      .set('Content-Type', 'application/json').send('{"broken"').expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('requires a well-formed Idempotency-Key header', async () => {
    const body = { customer, items: [{ productId: String(keyboard._id), quantity: 1 }] };
    const missing = await ctx.request.post('/api/v1/orders').send(body).expect(400);
    expect(missing.body.error.message).toMatch(/Idempotency-Key/);
    await checkout(body, 'short').expect(400);
    await checkout(body, 'has spaces in it').expect(400);
  });
});

describe('ACCEPTANCE TEST 1: idempotency', () => {
  const body = () => ({ customer, items: [{ productId: String(keyboard._id), quantity: 3 }] });

  test('sequential repeats with the same key return the same order and deduct stock once', async () => {
    const key = newKey();
    const first = await checkout(body(), key).expect(201);
    const second = await checkout(body(), key).expect(200);
    const third = await checkout(body(), key).expect(200);

    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(third.body.id).toBe(first.body.id);
    expect(await Order.countDocuments({ idempotencyKey: key })).toBe(1);
    expect(await stockOf(keyboard)).toBe(37); // 40 - 3, not 40 - 9
  });

  test('20 concurrent requests with the same key create exactly one order', async () => {
    const key = newKey();
    const responses = await Promise.all(Array.from({ length: 20 }, () => checkout(body(), key)));

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(19);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await Order.countDocuments()).toBe(1);
    expect(await stockOf(keyboard)).toBe(37);
  });

  test('reusing a key with a different body is rejected and changes nothing', async () => {
    const key = newKey();
    await checkout(body(), key).expect(201);
    const res = await checkout({ customer, items: [{ productId: String(keyboard._id), quantity: 5 }] }, key).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await stockOf(keyboard)).toBe(37);
    expect(await Order.countDocuments()).toBe(1);
  });

  test('a failed checkout does not consume the key; a later valid retry succeeds', async () => {
    const key = newKey();
    await checkout({ customer, items: [{ productId: String(monitor._id), quantity: 50 }] }, key).expect(409);
    await Product.updateOne({ _id: monitor._id }, { stock: 60 });
    await checkout({ customer, items: [{ productId: String(monitor._id), quantity: 50 }] }, key).expect(201);
    expect(await stockOf(monitor)).toBe(10);
  });
});

describe('inventory never goes negative under concurrency', () => {
  test('30 concurrent buyers for 12 monitors: exactly 12 succeed, stock ends at 0', async () => {
    const responses = await Promise.all(
      Array.from({ length: 30 }, () => checkout({ customer, items: [{ productId: String(monitor._id), quantity: 1 }] })),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(12);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(18);
    expect(await stockOf(monitor)).toBe(0);
    expect(await Order.countDocuments()).toBe(12);
  });
});

describe('order status API', () => {
  test('returns status and history; 404 for unknown order', async () => {
    const created = await checkout({ customer, items: [{ productId: String(keyboard._id), quantity: 1 }] }).expect(201);
    const res = await ctx.request.get(`/api/v1/orders/${created.body.id}/status`).expect(200);
    expect(res.body).toMatchObject({ orderId: created.body.id, status: 'CONFIRMED' });
    expect(res.body.history[0]).toMatchObject({ status: 'CONFIRMED', by: 'customer' });
    await ctx.request.get('/api/v1/orders/0123456789abcdef01234567/status').expect(404);
  });
});
