'use strict';

const mysql = require('mysql2/promise');
const config = require('../config/env');

const pool = mysql.createPool({
  ...config.mysql,
  waitForConnections: true,
  connectionLimit: 10,
  // Store and read every DATETIME as UTC so comparisons with `new Date()` are unambiguous.
  timezone: 'Z',
});

/**
 * Runs `fn(conn)` inside a transaction. Commits on success, rolls back on any throw.
 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
