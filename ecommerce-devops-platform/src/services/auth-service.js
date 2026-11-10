'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AdminUser } = require('../models');
const { unauthorized } = require('../utils/errors');

const BCRYPT_COST = 12;
// Compared against when the username does not exist, so a wrong username and a
// wrong password take the same time (prevents username enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);

async function login({ username, password }, config) {
  const user = await AdminUser.findOne({ username: username.toLowerCase() }).lean();
  const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !matches) throw unauthorized('Invalid username or password');

  const token = jwt.sign({ username: user.username, role: user.role }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(user._id),
    issuer: 'ecommerce-api',
    audience: 'ecommerce-admin',
    expiresIn: config.JWT_EXPIRES_IN,
  });
  return { token, tokenType: 'Bearer', expiresIn: config.JWT_EXPIRES_IN };
}

module.exports = { login, hashPassword, BCRYPT_COST };
