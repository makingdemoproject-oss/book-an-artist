'use strict';

const { DataTypes, Model } = require('sequelize');

class Payment extends Model {}

function initPayment(sequelize) {
  Payment.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      booking_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      // DECIMAL, never FLOAT, for money. Returned as a string to avoid float rounding.
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0 } },
      currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'INR' },
      status: {
        type: DataTypes.ENUM('pending', 'succeeded', 'failed', 'refunded'),
        allowNull: false,
        defaultValue: 'pending',
      },
      provider_ref: { type: DataTypes.STRING(100), allowNull: true, unique: 'uq_payments_provider_ref' },
    },
    { sequelize, modelName: 'Payment', tableName: 'payments' },
  );
  return Payment;
}

module.exports = { Payment, initPayment };
