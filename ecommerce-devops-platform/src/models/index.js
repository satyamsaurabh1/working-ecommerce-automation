'use strict';

// Requiring this file registers every model with Mongoose (needed by connectDatabase's index build).
const Product = require('./product');
const { Order, ORDER_STATUSES, STATUS_TRANSITIONS } = require('./order');
const AuditEvent = require('./audit-event');
const AdminUser = require('./admin-user');

module.exports = { Product, Order, AuditEvent, AdminUser, ORDER_STATUSES, STATUS_TRANSITIONS };
