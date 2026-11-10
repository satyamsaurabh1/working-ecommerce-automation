'use strict';

const { loadConfig } = require('../../src/config/env');

const valid = { MONGO_URI: 'mongodb://localhost:27017/x', JWT_SECRET: 'a'.repeat(32) };

describe('configuration validation', () => {
  test('applies safe defaults', () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.CORS_ORIGINS).toEqual([]);
  });

  test('parses a comma-separated CORS allow-list', () => {
    expect(loadConfig({ ...valid, CORS_ORIGINS: 'https://a.test, https://b.test' }).CORS_ORIGINS)
      .toEqual(['https://a.test', 'https://b.test']);
  });

  test('rejects a short JWT secret without echoing its value', () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'short-secret' })).toThrow(/JWT_SECRET must be at least 32/);
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'short-secret' })).not.toThrow(/short-secret/);
  });

  test('rejects a missing or malformed MONGO_URI', () => {
    expect(() => loadConfig({ JWT_SECRET: valid.JWT_SECRET })).toThrow(/MONGO_URI/);
    expect(() => loadConfig({ ...valid, MONGO_URI: 'http://nope' })).toThrow(/mongodb:\/\//);
  });

  test('the config object is immutable', () => {
    expect(Object.isFrozen(loadConfig(valid))).toBe(true);
  });
});
