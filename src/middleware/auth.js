'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const AppError = require('../utils/AppError');

/** Verifies the Bearer JWT and sets req.user = { id, role }. Stateless — no sessions or cookies. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    req.user = { id: Number(payload.sub), role: payload.role };
    return next();
  } catch (err) {
    return next(AppError.unauthorized('Invalid or expired token'));
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(AppError.forbidden(`Only ${roles.join(' or ')} users can perform this action`));
  }
  return next();
};

module.exports = { authenticate, requireRole };
