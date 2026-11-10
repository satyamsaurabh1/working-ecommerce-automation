'use strict';

const mongoose = require('mongoose');

/** Append-only record of every administrative change: who, what, before and after. */
const auditEventSchema = new mongoose.Schema(
  {
    actor: { type: String, required: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true, index: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditEventSchema.index({ createdAt: -1 });

module.exports = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
