'use strict';

const mongoose = require('mongoose');
const config = require('../config/env');
const logger = require('../utils/logger');

// Reject unknown fields in filters, and neutralise `$`-operators smuggled in via user input
// (NoSQL injection, e.g. { "score": { "$gt": 0 } } arriving from a request body).
mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

async function connectMongo() {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(config.mongo.uri, {
    dbName: config.mongo.dbName,
    maxPoolSize: config.mongo.poolSize,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
    // Building indexes on every boot is expensive on large collections; in production indexes
    // are created by the setup/migration step (`npm run setup` calls syncIndexes()).
    autoIndex: !config.isProduction,
  });
  return mongoose.connection;
}

async function pingMongo() {
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB not connected');
  await mongoose.connection.db.admin().ping();
}

async function disconnectMongo() {
  await mongoose.disconnect();
}

module.exports = { connectMongo, pingMongo, disconnectMongo };
