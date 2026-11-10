'use strict';

/** Converts Mongo documents to API shapes: `_id` becomes `id`, internals are dropped. */
function toProduct(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest };
}

function toOrder(doc) {
  if (!doc) return null;
  const { _id, requestHash: _hash, items, ...rest } = doc;
  return {
    id: String(_id),
    ...rest,
    items: items.map((item) => ({ ...item, productId: String(item.productId) })),
  };
}

function toAuditEvent(doc) {
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest };
}

module.exports = { toProduct, toOrder, toAuditEvent };
