'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config/env');

/** Creates the database if needed and applies db/schema.sql (idempotent). */
async function migrate(database = config.mysql.database) {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error(`Unsafe database name: ${database}`);

  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await conn.query(`USE \`${database}\``);
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await conn.query(schema);
  } finally {
    await conn.end();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => console.log(`Migrated MySQL database '${config.mysql.database}'`))
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}
