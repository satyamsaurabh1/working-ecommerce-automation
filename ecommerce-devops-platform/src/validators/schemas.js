'use strict';

const { z } = require('zod');

/**
 * Every request body, query and path parameter is validated against a strict
 * schema. Strict objects reject unknown keys, which also blocks NoSQL operator
 * injection such as {"price": {"$gt": 0}} because only primitives are accepted.
 */
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a 24-character hex id');
const money = z.number().int('must be an integer amount in paise').min(0).max(1_000_000_000);

const idParam = z.strictObject({ id: objectId });

const listProductsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().toLowerCase().max(50).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idempotencyKey = z
  .string({ error: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Idempotency-Key must be 8-128 characters of A-Z, a-z, 0-9, _ or -');

const createOrderBody = z.strictObject({
  customer: z.strictObject({
    name: z.string().trim().min(1).max(100),
    email: z.email().max(254),
  }),
  items: z
    .array(
      z.strictObject({
        productId: objectId,
        quantity: z.number().int('quantity must be a whole number').min(1).max(100),
      }),
    )
    .min(1, 'at least one item is required')
    .max(20, 'at most 20 items per order'),
});

const loginBody = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const createProductBody = z.strictObject({
  sku: z.string().regex(/^[A-Za-z0-9-]{3,32}$/, 'sku must be 3-32 letters, digits or hyphens'),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  category: z.string().trim().min(1).max(50),
  price: money,
  stock: z.number().int().min(0).max(1_000_000),
  active: z.boolean().optional(),
});

const updateProductBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    price: money.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'provide at least one field to update');

const reason = z.string().trim().min(3).max(200);

const updateStockBody = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('set'), quantity: z.number().int().min(0).max(1_000_000), reason }),
  z.strictObject({
    operation: z.literal('adjust'),
    delta: z.number().int().min(-1_000_000).max(1_000_000).refine((d) => d !== 0, 'delta must not be 0'),
    reason,
  }),
]);

const updateOrderStatusBody = z.strictObject({
  status: z.enum(['SHIPPED', 'DELIVERED', 'CANCELLED']),
  reason: reason.optional(),
});

const listAuditQuery = z.object({
  entityId: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

module.exports = {
  idParam,
  listProductsQuery,
  idempotencyKey,
  createOrderBody,
  loginBody,
  createProductBody,
  updateProductBody,
  updateStockBody,
  updateOrderStatusBody,
  listAuditQuery,
};
