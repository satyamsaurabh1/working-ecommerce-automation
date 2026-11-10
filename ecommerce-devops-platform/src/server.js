'use strict';

const { loadConfig } = require('./config/env');
const { createLogger } = require('./utils/logger');
const { connectDatabase, disconnectDatabase } = require('./config/db');
const { createApp } = require('./app');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    createLogger().fatal({ event: 'config_invalid' }, err.message);
    process.exit(1);
  }

  const logger = createLogger({ level: config.LOG_LEVEL, version: config.APP_VERSION });
  await connectDatabase(config.MONGO_URI, logger);

  const app = createApp({ config, logger });
  const server = app.listen(config.PORT, () =>
    logger.info({ event: 'server_started', port: config.PORT, env: config.NODE_ENV }, 'API listening'),
  );

  // Graceful shutdown: `docker stop` sends SIGTERM. Stop accepting requests,
  // let in-flight requests finish, close the DB pool, then exit.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'shutdown_started', signal }, 'shutting down');
    const forceExit = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      await disconnectDatabase().catch(() => {});
      clearTimeout(forceExit);
      logger.info({ event: 'shutdown_complete' }, 'bye');
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  createLogger().fatal({ err }, 'startup failed');
  process.exit(1);
});
