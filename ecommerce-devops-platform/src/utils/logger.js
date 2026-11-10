'use strict';

const pino = require('pino');

/**
 * Structured JSON logger. One JSON object per line is easy to grep, ship to a
 * log platform, or filter with `docker compose logs app`.
 * Sensitive fields are redacted so tokens and passwords never reach the logs.
 */
function createLogger({ level = 'info', version = 'dev' } = {}) {
  return pino({
    level,
    base: { service: 'ecommerce-api', version },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', 'token'],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
