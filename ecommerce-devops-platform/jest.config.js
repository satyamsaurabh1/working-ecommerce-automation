'use strict';

module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/helpers/global-setup.js',
  globalTeardown: '<rootDir>/tests/helpers/global-teardown.js',
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageThreshold: { global: { lines: 80, branches: 70 } },
};
