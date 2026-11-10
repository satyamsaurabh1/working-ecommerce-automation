'use strict';

/**
 * Seeds the catalogue and the admin account. Safe to run repeatedly:
 * existing products keep their current stock and price ($setOnInsert),
 * and an existing admin's password is not overwritten.
 *
 * Env: MONGO_URI, ADMIN_USERNAME, ADMIN_PASSWORD
 */
const mongoose = require('mongoose');
const { ensureSchema } = require('../src/config/db');
const { Product, AdminUser } = require('../src/models');
const { hashPassword } = require('../src/services/auth-service');
const products = require('../src/data/seed-products');

async function seed({ uri, adminUsername, adminPassword, log = console.log }) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await ensureSchema();

    let inserted = 0;
    for (const product of products) {
      const result = await Product.updateOne({ sku: product.sku }, { $setOnInsert: product }, { upsert: true });
      inserted += result.upsertedCount;
    }
    log(JSON.stringify({ event: 'seed_products', inserted, alreadyPresent: products.length - inserted }));

    if (adminUsername && adminPassword) {
      if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
      const existing = await AdminUser.exists({ username: adminUsername.toLowerCase() });
      if (!existing) {
        await AdminUser.create({ username: adminUsername, passwordHash: await hashPassword(adminPassword) });
      }
      log(JSON.stringify({ event: 'seed_admin', username: adminUsername.toLowerCase(), created: !existing }));
    } else {
      log(JSON.stringify({ event: 'seed_admin', skipped: true, reason: 'ADMIN_USERNAME/ADMIN_PASSWORD not set' }));
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is required');
    process.exit(1);
  }
  seed({
    uri: process.env.MONGO_URI,
    adminUsername: process.env.ADMIN_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD,
  }).catch((err) => {
    console.error(JSON.stringify({ event: 'seed_failed', error: err.message }));
    process.exit(1);
  });
}

module.exports = { seed };
