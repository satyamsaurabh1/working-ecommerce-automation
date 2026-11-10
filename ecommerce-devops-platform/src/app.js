'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('./models');
const { buildRouter } = require('./routes');
const { requestLogger, metricsMiddleware } = require('./middleware/request-context');
const { notFoundHandler, errorHandler } = require('./middleware/error-handler');

/** Builds the Express app without starting a server, so tests can use it directly. */
function createApp({ config, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // exactly one proxy (Nginx) in front; needed for correct client IPs

  app.use(helmet());
  app.use(
    cors({
      // Only listed origins may call the API from a browser. Non-browser clients send no Origin.
      origin: (origin, done) => done(null, !origin || config.CORS_ORIGINS.includes(origin)),
      methods: ['GET', 'POST', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
    }),
  );
  app.use(requestLogger(logger));
  app.use(metricsMiddleware);
  app.use(express.json({ limit: '100kb' }));

  app.use(buildRouter(config));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
