'use strict';

// Test-only configuration. These values are not secrets and are never used outside tests.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';
process.env.APP_VERSION = 'test';
process.env.CORS_ORIGINS = 'https://allowed.example';
process.env.LOGIN_RATE_LIMIT_MAX = '5';
