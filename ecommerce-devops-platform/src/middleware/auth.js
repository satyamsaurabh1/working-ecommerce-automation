'use strict';

const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../utils/errors');

/** Authentication: verifies the Bearer JWT and attaches req.user. */
function requireAuth(config) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized());
    try {
      const claims = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ['HS256'], // never accept "none" or an unexpected algorithm
        issuer: 'ecommerce-api',
        audience: 'ecommerce-admin',
      });
      req.user = { id: claims.sub, username: claims.username, role: claims.role };
      return next();
    } catch {
      return next(unauthorized('Invalid or expired token'));
    }
  };
}

/** Authorization: the authenticated user must hold one of the given roles. */
function requireRole(...roles) {
  return (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
}

module.exports = { requireAuth, requireRole };
