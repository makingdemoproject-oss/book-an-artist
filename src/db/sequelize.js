'use strict';

const { Sequelize } = require('sequelize');
const config = require('../config/env');
const logger = require('../utils/logger');

const { host, port, user, password, database, poolSize } = config.mysql;

const sequelize = new Sequelize(database, user, password, {
  host,
  port,
  dialect: 'mysql',
  // Store and read every DATETIME as UTC so comparisons with `new Date()` are unambiguous.
  timezone: '+00:00',
  pool: { max: poolSize, min: 0, acquire: 15_000, idle: 10_000, evict: 10_000 },
  dialectOptions: { connectTimeout: 10_000 },
  // SQL logging only at debug level — it is noisy and can be expensive.
  benchmark: logger.isLevelEnabled('debug'),
  logging: logger.isLevelEnabled('debug') ? (sql, ms) => logger.debug({ sql, ms }, 'sql') : false,
  define: {
    // Tables use snake_case columns; keep attribute names identical so API payloads stay snake_case.
    underscored: true,
    freezeTableName: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
});

const MAX_DEADLOCK_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDeadlock = (err) => (err.parent || err.original || {}).code === 'ER_LOCK_DEADLOCK';

/**
 * Runs `fn(t)` inside a managed transaction (auto commit / rollback).
 *
 * InnoDB may pick this transaction as a deadlock victim under contention; that is transient,
 * so the whole unit of work is retried (with jittered backoff) before surfacing an error.
 * `fn` must be safe to re-run — it is, because everything it did was rolled back.
 */
async function withTransaction(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sequelize.transaction((t) => fn(t));
    } catch (err) {
      if (!isDeadlock(err) || attempt >= MAX_DEADLOCK_RETRIES) throw err;
      logger.warn({ attempt }, 'deadlock detected, retrying transaction');
      await sleep(20 * attempt + Math.floor(Math.random() * 30));
    }
  }
}

async function pingMysql() {
  await sequelize.authenticate({ logging: false });
}

async function closeMysql() {
  await sequelize.close();
}

module.exports = { sequelize, withTransaction, pingMysql, closeMysql };
