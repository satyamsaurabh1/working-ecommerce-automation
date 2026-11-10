'use strict';

const { isDatabaseReady } = require('../config/db');
const { register } = require('../utils/metrics');

/** Liveness: the process is up and serving. Deliberately does NOT check the database. */
function health(config) {
  return (_req, res) =>
    res.json({ status: 'ok', service: 'ecommerce-api', version: config.APP_VERSION, uptimeSeconds: Math.round(process.uptime()) });
}

/** Readiness: can this instance serve real traffic? 503 tells proxies and monitors it cannot. */
async function ready(_req, res) {
  const database = await isDatabaseReady();
  res.status(database ? 200 : 503).json({
    status: database ? 'ready' : 'not_ready',
    checks: { database: database ? 'up' : 'down' },
  });
}

async function metrics(_req, res) {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
}

module.exports = { health, ready, metrics };
