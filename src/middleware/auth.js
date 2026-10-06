'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const AppError = require('../utils/AppError');

const ROLES = new Set(['artist', 'client']);

/** Verifies the Bearer JWT and sets req.user = { id, role }. Stateless — no sessions or cookies. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'], // pinned: blocks alg=none / algorithm-confusion attacks
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    const message = err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    return next(AppError.unauthorized(message));
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0 || !ROLES.has(payload.role)) {
    return next(AppError.unauthorized('Invalid token'));
  }

  req.user = { id, role: payload.role };
  return next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(AppError.forbidden(`Only ${roles.join(' or ')} users can perform this action`));
  }
  return next();
};

module.exports = { authenticate, requireRole };
