'use strict';

// Creates/migrates the isolated test database once per `npm test` run.
module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const { migrate } = require('../scripts/migrate');
  const config = require('../src/config/env');
  await migrate(config.mysql.database);
};
