'use strict';

const { Product } = require('../models');
const { notFound } = require('../utils/errors');
const { toProduct } = require('./serializers');

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Public catalogue: only active products are visible. */
async function listProducts({ q, category, inStock, page, limit }) {
  const filter = { active: true };
  if (q) {
    // User text is escaped, so it is matched literally and cannot inject a regex.
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: pattern }, { description: pattern }, { sku: pattern }];
  }
  if (category) filter.category = category;
  if (inStock === 'true') filter.stock = { $gt: 0 };
  if (inStock === 'false') filter.stock = 0;

  const [items, total] = await Promise.all([
    Product.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  return { data: items.map(toProduct), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getProduct(id) {
  const product = await Product.findOne({ _id: id, active: true }).lean();
  if (!product) throw notFound('Product not found');
  return toProduct(product);
}

module.exports = { listProducts, getProduct };
