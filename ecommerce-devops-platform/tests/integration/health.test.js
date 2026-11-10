'use strict';

const mongoose = require('mongoose');
const { setupTestApp } = require('../helpers/test-app');

const ctx = setupTestApp('health');

describe('health, readiness and metrics', () => {
  test('GET /health returns 200 with version and a request id header', async () => {
    const res = await ctx.request.get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'ecommerce-api', version: 'test' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  test('a safe incoming X-Request-Id is propagated', async () => {
    const res = await ctx.request.get('/health').set('X-Request-Id', 'trace-abc-12345').expect(200);
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  test('GET /ready returns 200 when the database is reachable', async () => {
    const res = await ctx.request.get('/ready').expect(200);
    expect(res.body).toEqual({ status: 'ready', checks: { database: 'up' } });
  });

  test('GET /metrics exposes Prometheus metrics including app_mongodb_up', async () => {
    await ctx.request.get('/health');
    const res = await ctx.request.get('/metrics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/app_mongodb_up 1/);
    expect(res.text).toMatch(/http_requests_total\{method="GET",route="\/health",status="200"\}/);
  });

  test('security headers are set and x-powered-by is hidden', async () => {
    const res = await ctx.request.get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('CORS allows only configured origins', async () => {
    const allowed = await ctx.request.get('/health').set('Origin', 'https://allowed.example');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');
    const denied = await ctx.request.get('/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('unknown routes return a JSON 404', async () => {
    const res = await ctx.request.get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('when the database goes away, /ready is 503, /health stays 200, and data routes return 503', async () => {
    const uri = ctx.config.MONGO_URI;
    await mongoose.disconnect();
    try {
      const ready = await ctx.request.get('/ready').expect(503);
      expect(ready.body).toEqual({ status: 'not_ready', checks: { database: 'down' } });
      await ctx.request.get('/health').expect(200);
      const products = await ctx.request.get('/api/v1/products').expect(503);
      expect(products.body.error.code).toBe('DATABASE_UNAVAILABLE');
      const metrics = await ctx.request.get('/metrics');
      expect(metrics.text).toMatch(/app_mongodb_up 0/);
    } finally {
      await mongoose.connect(uri);
    }
    await ctx.request.get('/ready').expect(200); // recovery
  });
});
