'use strict';

const authService = require('../services/auth-service');

function login(config) {
  return async (req, res) => {
    try {
      res.json(await authService.login(req.valid.body, config));
    } catch (err) {
      // Log the attempt (never the password) so brute force is visible in the logs.
      req.log.warn({ event: 'admin_login_failed', username: req.valid.body.username }, 'admin login failed');
      throw err;
    }
  };
}

module.exports = { login };
