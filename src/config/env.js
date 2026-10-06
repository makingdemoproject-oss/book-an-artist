'use strict';

require('dotenv').config({ quiet: true });

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const baseDb = process.env.MYSQL_DATABASE || 'book_an_artist';

const config = {
  env,
  isTest,
  port: Number(process.env.PORT) || 3000,

  jwt: {
    // Tests get a throwaway secret so `npm test` works without extra setup.
    secret: required('JWT_SECRET', isTest ? 'test-only-secret-not-for-real-use-0123456789' : undefined),
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  },

  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,

  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: isTest ? process.env.MYSQL_DATABASE_TEST || `${baseDb}_test` : baseDb,
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
    dbName: process.env.MONGO_DB_NAME || 'book_an_artist',
  },
};

if (!isTest && config.jwt.secret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

module.exports = config;
