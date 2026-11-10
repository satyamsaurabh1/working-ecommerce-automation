'use strict';

const mongoose = require('mongoose');

/**
 * Prices are stored as integers in the smallest currency unit (paise for INR).
 * Floating point cannot represent 0.1 exactly, so money is never a float here.
 */
const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    category: { type: String, required: true, lowercase: true, trim: true, index: true },
    price: { type: Number, required: true, min: 0, validate: Number.isInteger },
    currency: { type: String, default: 'INR', enum: ['INR'] },
    // min: 0 is a second line of defence; checkout uses a conditional update.
    stock: { type: Number, required: true, min: 0, validate: Number.isInteger },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);


module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
