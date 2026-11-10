'use strict';

const { setupTestApp, seedCatalogue } = require('../helpers/test-app');
const { Product } = require('../../src/models');

const ctx = setupTestApp('products');

describe('product catalogue', () => {
  beforeEach(seedCatalogue);

  test('lists active products with pagination metadata', async () => {
    const res = await ctx.request.get('/api/v1/products').expect(200);
    expect(res.body.data).toHaveLength(8);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 8, pages: 1 });
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: expect.any(String), price: expect.any(Number) }));
    expect(res.body.data[0]._id).toBeUndefined();
  });

  test('searches by partial, case-insensitive name', async () => {
    const res = await ctx.request.get('/api/v1/products?q=MOUSE').expect(200);
    expect(res.body.data.map((p) => p.sku)).toEqual(['MS-WL-02']);
  });

  test('regex metacharacters in search are treated literally', async () => {
    const res = await ctx.request.get('/api/v1/products?q=.*').expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('filters by category and paginates', async () => {
    const res = await ctx.request.get('/api/v1/products?category=Electronics&limit=2&page=2').expect(200);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 2, total: 4, pages: 2 });
    expect(res.body.data).toHaveLength(2);
  });

  test('filters by stock availability', async () => {
    await Product.updateOne({ sku: 'NB-A5-08' }, { stock: 0 });
    const out = await ctx.request.get('/api/v1/products?inStock=false').expect(200);
    expect(out.body.data.map((p) => p.sku)).toEqual(['NB-A5-08']);
  });

  test('inactive products are hidden', async () => {
    await Product.updateOne({ sku: 'MS-WL-02' }, { active: false });
    const res = await ctx.request.get('/api/v1/products').expect(200);
    expect(res.body.pagination.total).toBe(7);
  });

  test('rejects invalid query parameters with 400 and field details', async () => {
    const res = await ctx.request.get('/api/v1/products?limit=1000').expect(400);
    expect(res.body.error.details[0].field).toBe('limit');
  });

  test('returns product details by id', async () => {
    const product = await Product.findOne({ sku: 'KB-MECH-01' });
    const res = await ctx.request.get(`/api/v1/products/${product.id}`).expect(200);
    expect(res.body).toMatchObject({ sku: 'KB-MECH-01', price: 449900, stock: 40 });
  });

  test('malformed id -> 400, unknown id -> 404', async () => {
    await ctx.request.get('/api/v1/products/not-an-id').expect(400);
    await ctx.request.get('/api/v1/products/0123456789abcdef01234567').expect(404);
  });
});
