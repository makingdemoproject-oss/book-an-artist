'use strict';

const { sequelize, User, Booking, BookingStatusHistory, Payment } = require('../src/models/sql');

/**
 * Empties every MySQL table (local seed + tests only).
 * Runs on a single connection via a transaction, because FOREIGN_KEY_CHECKS is per-session.
 */
async function resetMysql() {
  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    for (const model of [Payment, BookingStatusHistory, Booking, User]) {
      await model.truncate({ transaction });
    }
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
  });
}

module.exports = { resetMysql };
