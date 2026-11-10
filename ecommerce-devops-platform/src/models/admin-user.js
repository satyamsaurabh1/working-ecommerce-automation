'use strict';

const mongoose = require('mongoose');

/** Only a bcrypt hash is stored; the plain password never touches the database. */
const adminUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin'], default: 'admin' },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.models.AdminUser || mongoose.model('AdminUser', adminUserSchema);
