'use strict';

const mongoose = require('mongoose');
const config = require('../config/env');

async function connectMongo() {
  await mongoose.connect(config.mongo.uri, {
    dbName: config.mongo.dbName,
    serverSelectionTimeoutMS: 10000,
  });
  return mongoose.connection;
}

async function disconnectMongo() {
  await mongoose.disconnect();
}

module.exports = { connectMongo, disconnectMongo };
