'use strict';

const pino = require('pino');
const config = require('../config/env');

// Structured JSON logs. Credentials and tokens are never written to logs.
const logger = pino({
  level: config.logLevel,
  base: { service: 'book-an-artist', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.password_hash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
