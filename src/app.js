'use strict';

const express = require('express');
const helmet = require('helmet');
const { sendSuccess } = require('./utils/response');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const bookingRoutes = require('./modules/bookings/bookings.routes');
const artistRoutes = require('./modules/artists/artists.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => sendSuccess(res, { status: 'ok' }));

  app.use('/auth', authRoutes);
  app.use('/bookings', bookingRoutes);
  app.use('/artists', artistRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
