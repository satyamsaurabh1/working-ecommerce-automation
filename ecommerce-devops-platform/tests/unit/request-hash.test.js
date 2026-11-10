'use strict';

const { canonicalJson, hashRequest } = require('../../src/utils/request-hash');

describe('request fingerprinting for idempotency', () => {
  test('key order does not change the hash', () => {
    expect(hashRequest({ a: 1, b: { c: 2, d: 3 } })).toBe(hashRequest({ b: { d: 3, c: 2 }, a: 1 }));
  });

  test('different payloads produce different hashes', () => {
    expect(hashRequest({ items: [{ quantity: 1 }] })).not.toBe(hashRequest({ items: [{ quantity: 2 }] }));
  });

  test('array order is significant', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});
