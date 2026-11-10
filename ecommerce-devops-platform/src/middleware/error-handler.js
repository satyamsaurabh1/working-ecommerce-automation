'use strict';

const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

/**
 * Central error handler. Known errors get their status and message; anything
 * unexpected is logged in full but the client only sees a generic 500 with the
 * request id, so stack traces and internals are never leaked.
 */
function errorHandler(err, req, res, _next) {
  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };

  if (err instanceof AppError) {
    status = err.status;
    body = { code: err.code, message: err.message, ...(err.details && { details: err.details }) };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  } else if (err.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  } else if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNotConnectedError' ||
             /buffering timed out|Client must be connected|not connected/i.test(err.message || '')) {
    status = 503;
    body = { code: 'DATABASE_UNAVAILABLE', message: 'Database is temporarily unavailable, please retry' };
  }

  if (status >= 500) req.log?.error({ err }, 'request failed');
  res.status(status).json({ error: { ...body, requestId: req.id } });
}

module.exports = { notFoundHandler, errorHandler };
