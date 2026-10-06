'use strict';

const config = require('./config/env');
const { createApp } = require('./app');
const { pool } = require('./db/mysql');
const { connectMongo, disconnectMongo } = require('./db/mongo');

async function start() {
  // Fail fast if either database is unreachable.
  await pool.query('SELECT 1');
  await connectMongo();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`book-an-artist API listening on http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await Promise.allSettled([pool.end(), disconnectMongo()]);
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
