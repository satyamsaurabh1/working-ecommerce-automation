'use strict';

const mongoose = require('mongoose');

// Fail queries fast while disconnected instead of silently buffering them.
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);
// Collections and indexes are created explicitly after connecting (ensureSchema),
// not implicitly at require time when no connection exists yet.
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

let listenersAttached = false;

async function connectDatabase(uri, logger) {
  if (!listenersAttached) {
    listenersAttached = true;
    const c = mongoose.connection;
    c.on('connected', () => logger.info({ event: 'db_connected' }, 'MongoDB connected'));
    c.on('disconnected', () => logger.warn({ event: 'db_disconnected' }, 'MongoDB disconnected'));
    c.on('reconnected', () => logger.info({ event: 'db_reconnected' }, 'MongoDB reconnected'));
    c.on('error', (err) => logger.error({ event: 'db_error', err: err.message }, 'MongoDB error'));
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 });
  await ensureSchema();
}

/**
 * Creates every collection and index (including the unique Idempotency-Key
 * index) before traffic is served. Idempotent: safe to run on every start.
 */
async function ensureSchema() {
  for (const model of Object.values(mongoose.models)) {
    try {
      await model.createCollection();
    } catch (err) {
      if (err?.code !== 48) throw err; // 48 = NamespaceExists
    }
    await model.createIndexes();
  }
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

/** Readiness: connected AND the server answers a ping within 1 s. */
async function isDatabaseReady() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db.admin().command({ ping: 1 }, { maxTimeMS: 1000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { connectDatabase, disconnectDatabase, isDatabaseReady, ensureSchema };
