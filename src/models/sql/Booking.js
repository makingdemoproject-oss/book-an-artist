'use strict';

const { DataTypes, Model } = require('sequelize');
const { STATUSES } = require('../../modules/bookings/bookingStateMachine');

class Booking extends Model {}

function initBooking(sequelize) {
  Booking.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      artist_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'pending' },
      event_start: { type: DataTypes.DATE, allowNull: false },
      event_end: { type: DataTypes.DATE, allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: false },
      cancelled_by: { type: DataTypes.ENUM('artist', 'client'), allowNull: true },
    },
    {
      sequelize,
      modelName: 'Booking',
      tableName: 'bookings',
      validate: {
        // Mirrors the chk_bookings_window CHECK constraint in db/schema.sql.
        endAfterStart() {
          if (this.event_start && this.event_end && this.event_end <= this.event_start) {
            throw new Error('event_end must be after event_start');
          }
        },
      },
    },
  );
  return Booking;
}

module.exports = { Booking, initBooking };
