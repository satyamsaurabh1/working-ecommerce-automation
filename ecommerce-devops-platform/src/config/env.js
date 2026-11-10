'use strict';

const { z } = require('zod');

/**
 * All configuration comes from environment variables and is validated once at
 * startup. If anything is missing or malformed the process exits immediately
 * (fail fast) instead of running with an insecure or broken configuration.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_VERSION: z.string().default('dev'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGO_URI must be a mongodb:// URI'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((o) => o.trim()).filter(Boolean)),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
});

function loadConfig(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    // Never print values here: they could be secrets.
    throw new Error(`Invalid configuration -> ${problems.join('; ')}`);
  }
  return Object.freeze(result.data);
}

module.exports = { loadConfig };
