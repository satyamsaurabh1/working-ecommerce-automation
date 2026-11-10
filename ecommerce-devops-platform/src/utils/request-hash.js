'use strict';

const crypto = require('node:crypto');

/** Serialise with sorted keys so {a,b} and {b,a} hash identically. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Fingerprint of a checkout payload, used to detect Idempotency-Key reuse with a different body. */
function hashRequest(payload) {
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

module.exports = { canonicalJson, hashRequest };
