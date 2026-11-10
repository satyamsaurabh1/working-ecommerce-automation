'use strict';

/**
 * ACCEPTANCE TEST 1 against a RUNNING deployment (through Nginx by default).
 *
 *   node scripts/acceptance/idempotency-check.js
 *
 * Env: BASE_URL (default https://localhost), INSECURE_TLS=1 to accept the
 * local self-signed certificate. Exit code 0 = PASS, 1 = FAIL.
 */
const crypto = require('node:crypto');

const BASE_URL = process.env.BASE_URL || 'https://localhost';
if (process.env.INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PARALLEL = 10;
const SEQUENTIAL = 3;
const QUANTITY = 2;

async function call(method, path, { body, key } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key && { 'Idempotency-Key': key }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, replayed: res.headers.get('idempotent-replayed'), body: await res.json() };
}

function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  return condition;
}

async function main() {
  console.log(`Idempotency acceptance test against ${BASE_URL}\n`);
  const ready = await call('GET', '/ready');
  if (!check('service is ready', ready.status === 200, `HTTP ${ready.status}`)) process.exit(1);

  const list = await call('GET', '/api/v1/products?inStock=true&limit=100');
  const product = list.body.data.find((p) => p.stock >= QUANTITY + 5);
  if (!check('found a product with enough stock', Boolean(product))) process.exit(1);
  const stockBefore = product.stock;
  console.log(`      product ${product.sku}, stock before = ${stockBefore}\n`);

  const key = `acceptance-${crypto.randomUUID()}`;
  const body = { customer: { name: 'Acceptance Test', email: 'acceptance@example.com' }, items: [{ productId: product.id, quantity: QUANTITY }] };

  console.log(`Sending ${PARALLEL} concurrent + ${SEQUENTIAL} sequential checkouts with Idempotency-Key ${key}`);
  const responses = await Promise.all(Array.from({ length: PARALLEL }, () => call('POST', '/api/v1/orders', { body, key })));
  for (let i = 0; i < SEQUENTIAL; i += 1) responses.push(await call('POST', '/api/v1/orders', { body, key }));

  const statuses = responses.map((r) => r.status);
  const orderIds = new Set(responses.map((r) => r.body.id));
  console.log(`      statuses: ${statuses.join(',')}\n`);

  const after = await call('GET', `/api/v1/products/${product.id}`);
  const reuse = await call('POST', '/api/v1/orders', { key, body: { ...body, items: [{ productId: product.id, quantity: QUANTITY + 1 }] } });
  const afterReuse = await call('GET', `/api/v1/products/${product.id}`);

  const results = [
    check('exactly one request created an order (201)', statuses.filter((s) => s === 201).length === 1),
    check('all other requests were replays (200)', statuses.filter((s) => s === 200).length === PARALLEL + SEQUENTIAL - 1),
    check('every response returned the same order id', orderIds.size === 1, [...orderIds].join(',')),
    check('stock deducted exactly once', after.body.stock === stockBefore - QUANTITY, `${stockBefore} -> ${after.body.stock}`),
    check('same key + different body is rejected (409)', reuse.status === 409 && reuse.body.error.code === 'IDEMPOTENCY_KEY_REUSED'),
    check('rejected reuse did not change stock', afterReuse.body.stock === after.body.stock),
  ];

  const passed = results.every(Boolean);
  console.log(`\nRESULT: ${passed ? 'PASS' : 'FAIL'}  (order ${[...orderIds][0]})`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`FAIL  ${err.message}`);
  process.exit(1);
});
