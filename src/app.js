'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { corsMiddleware, globalRateLimiter, requireJson } = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { sendSuccess, sendError } = require('./utils/response');
const { pingMysql } = require('./db/sequelize');
const { pingMongo } = require('./db/mongo');
const authRoutes = require('./modules/auth/auth.routes');
const bookingRoutes = require('./modules/bookings/bookings.routes');
const artistRoutes = require('./modules/artists/artists.routes');

/**
 * @param {{ isShuttingDown?: () => boolean }} [lifecycle] lets /ready report 503 while draining.
 */
function createApp(lifecycle = {}) {
  const isShuttingDown = lifecycle.isShuttingDown || (() => false);
  const app = express();

  // ── Platform ─────────────────────────────────────────────────
  app.disable('x-powered-by');
  app.set('trust proxy', config.security.trustProxy); // real client IP for rate limiting behind a LB
  app.set('query parser', 'simple'); // no nested objects from ?a[b]=c

  // ── Probes (before rate limiting / logging so orchestrators are never throttled) ──
  app.get('/health', (req, res) => sendSuccess(res, { status: 'ok' })); // liveness
  app.get('/ready', async (req, res) => {
    // readiness: stop routing traffic here while draining or if a dependency is down
    if (isShuttingDown()) return sendError(res, 503, 'Shutting down');
    try {
      await Promise.all([pingMysql(), pingMongo()]);
      return sendSuccess(res, { status: 'ready' });
    } catch (err) {
      return sendError(res, 503, 'Dependencies unavailable');
    }
  });

  // ── Cross-cutting middleware ─────────────────────────────────
  app.use(requestLogger);
  app.use(helmet());
  app.use(corsMiddleware);
  app.use(globalRateLimiter);
  app.use(compression({ threshold: 1024 }));
  app.use(requireJson);
  app.use(express.json({ limit: '100kb', strict: true }));

  // While draining, ask clients to close keep-alive connections so they reconnect elsewhere.
  app.use((req, res, next) => {
    if (isShuttingDown()) res.set('Connection', 'close');
    next();
  });

  // ── Routes ───────────────────────────────────────────────────
  app.use('/auth', authRoutes);
  app.use('/bookings', bookingRoutes);
  app.use('/artists', artistRoutes);

  // ── Errors (must be last) ────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
