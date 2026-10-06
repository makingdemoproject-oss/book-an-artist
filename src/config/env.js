'use strict';

require('dotenv').config({ quiet: true });

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';
const isProduction = env === 'production';

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const int = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (name) =>
  (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const baseDb = process.env.MYSQL_DATABASE || 'book_an_artist';

const config = {
  env,
  isTest,
  isProduction,
  port: int('PORT', 3000),
  // Tests are silent unless TEST_LOG_LEVEL is set, so .env's LOG_LEVEL doesn't flood jest output.
  logLevel: isTest ? process.env.TEST_LOG_LEVEL || 'silent' : process.env.LOG_LEVEL || 'info',

  jwt: {
    // Tests get a throwaway secret so `npm test` works without extra setup.
    // Validated by assertServerConfig() at server start — scripts like db:migrate don't need it.
    secret: process.env.JWT_SECRET || (isTest ? 'test-only-secret-not-for-real-use-0123456789' : ''),
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    issuer: process.env.JWT_ISSUER || 'book-an-artist',
    audience: process.env.JWT_AUDIENCE || 'book-an-artist-api',
  },

  bcryptRounds: int('BCRYPT_ROUNDS', 10),

  security: {
    corsOrigins: list('CORS_ORIGINS'),
    trustProxy: int('TRUST_PROXY', 0),
    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: int('RATE_LIMIT_MAX', 300),
  },

  server: {
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 30_000),
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10_000),
  },

  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: int('MYSQL_PORT', 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: isTest ? process.env.MYSQL_DATABASE_TEST || `${baseDb}_test` : baseDb,
    poolSize: int('MYSQL_POOL_SIZE', 10),
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
    dbName: process.env.MONGO_DB_NAME || 'book_an_artist',
    poolSize: int('MONGO_POOL_SIZE', 10),
  },
};

/** Settings only the HTTP server needs. Called from server.js so CLI scripts don't require them. */
function assertServerConfig() {
  required('JWT_SECRET', config.jwt.secret);
  if (config.jwt.secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
}

module.exports = config;
module.exports.assertServerConfig = assertServerConfig;
