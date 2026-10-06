'use strict';

const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { sendError } = require('../utils/response');

/** Only allow browsers from the configured origins. Non-browser clients (no Origin header) pass. */
const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin || config.security.corsOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
  maxAge: 600,
});

const rateLimitHandler = (message) => (req, res) => {
  res.set('Retry-After', String(Math.ceil(config.security.rateLimitWindowMs / 1000)));
  return sendError(res, 429, message);
};

/** Global per-IP limit, protects every endpoint from floods. */
const globalRateLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  limit: config.security.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: rateLimitHandler('Too many requests, please slow down'),
});

/** Much stricter limit for login to slow down credential stuffing / brute force. */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: rateLimitHandler('Too many login attempts, please try again later'),
});

/** Bodies on write requests must be JSON — rejects form posts / content-type confusion with 415. */
function requireJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.is('application/json') === false) {
    return next(AppError.unsupportedMediaType());
  }
  return next();
}

module.exports = { corsMiddleware, globalRateLimiter, loginRateLimiter, requireJson };
