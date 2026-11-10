'use strict';

const crypto = require('node:crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const supertest = require('supertest');
const { loadConfig } = require('../../src/config/env');
const { createLogger } = require('../../src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const { Product } = require('../../src/models');
const seedProducts = require('../../src/data/seed-products');

/** Each test file gets its own database on the shared replica set. */
function databaseUri(name) {
  const url = new URL(process.env.TEST_MONGO_URI);
  url.pathname = `/${name}_${crypto.randomBytes(4).toString('hex')}`;
  return url.toString();
}

function setupTestApp(name) {
  const ctx = {};

  beforeAll(async () => {
    ctx.config = loadConfig({ ...process.env, MONGO_URI: databaseUri(name) });
    const logger = createLogger({ level: 'silent' });
    await connectDatabase(ctx.config.MONGO_URI, logger);
    ctx.app = createApp({ config: ctx.config, logger });
    ctx.request = supertest(ctx.app);
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await disconnectDatabase();
  });

  return ctx;
}

async function seedCatalogue() {
  return Product.insertMany(seedProducts);
}

function signToken(config, { role = 'admin', username = 'admin', expiresIn = '5m' } = {}) {
  return jwt.sign({ username, role }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: new mongoose.Types.ObjectId().toString(),
    issuer: 'ecommerce-api',
    audience: 'ecommerce-admin',
    expiresIn,
  });
}

const newKey = () => `test-${crypto.randomUUID()}`;

module.exports = { setupTestApp, seedCatalogue, signToken, newKey };
