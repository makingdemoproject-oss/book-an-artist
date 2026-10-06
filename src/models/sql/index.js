'use strict';

/**
 * Sequelize models for the MySQL side (users, bookings, payments).
 *
 * The DDL source of truth is db/schema.sql (applied by `npm run db:migrate`) because it carries
 * CHECK constraints and named indexes that `sequelize.sync()` cannot express. These models map
 * onto those tables; `sync()` is intentionally never called.
 */
const { sequelize } = require('../../db/sequelize');
const { User, initUser } = require('./User');
const { Booking, initBooking } = require('./Booking');
const { BookingStatusHistory, initBookingStatusHistory } = require('./BookingStatusHistory');
const { Payment, initPayment } = require('./Payment');

initUser(sequelize);
initBooking(sequelize);
initBookingStatusHistory(sequelize);
initPayment(sequelize);

// ── Associations ────────────────────────────────────────────────
User.hasMany(Booking, { as: 'artistBookings', foreignKey: 'artist_id' });
User.hasMany(Booking, { as: 'clientBookings', foreignKey: 'client_id' });
Booking.belongsTo(User, { as: 'artist', foreignKey: 'artist_id' });
Booking.belongsTo(User, { as: 'client', foreignKey: 'client_id' });

Booking.hasMany(BookingStatusHistory, { as: 'history', foreignKey: 'booking_id' });
BookingStatusHistory.belongsTo(Booking, { foreignKey: 'booking_id' });
BookingStatusHistory.belongsTo(User, { as: 'changedBy', foreignKey: 'changed_by' });

Booking.hasMany(Payment, { as: 'payments', foreignKey: 'booking_id' });
Payment.belongsTo(Booking, { foreignKey: 'booking_id' });

module.exports = { sequelize, User, Booking, BookingStatusHistory, Payment };
