'use strict';

const crypto = require('node:crypto');
const pinoHttp = require('pino-http');
const { httpRequestsTotal, httpRequestDuration } = require('../utils/metrics');

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Per-request structured access log with a correlation id. The id is taken
 * from X-Request-Id (Nginx sets it) or generated, echoed back to the client
 * and included in every log line for that request.
 */
function requestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === '/metrics' },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}

/** Records request count and latency, labelled by route template (not raw URL) to keep cardinality low. */
function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

module.exports = { requestLogger, metricsMiddleware };
