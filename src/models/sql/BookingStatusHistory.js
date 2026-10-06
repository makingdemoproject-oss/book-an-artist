'use strict';

const { DataTypes, Model } = require('sequelize');
const { STATUSES } = require('../../modules/bookings/bookingStateMachine');

/** Append-only audit trail of booking state-machine transitions. */
class BookingStatusHistory extends Model {}

function initBookingStatusHistory(sequelize) {
  BookingStatusHistory.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      booking_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      from_status: { type: DataTypes.ENUM(...STATUSES), allowNull: true },
      to_status: { type: DataTypes.ENUM(...STATUSES), allowNull: false },
      changed_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      sequelize,
      modelName: 'BookingStatusHistory',
      tableName: 'booking_status_history',
      updatedAt: false,
    },
  );
  return BookingStatusHistory;
}

module.exports = { BookingStatusHistory, initBookingStatusHistory };
