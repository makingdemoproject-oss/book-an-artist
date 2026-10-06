'use strict';

const { DataTypes, Model } = require('sequelize');

const ROLES = ['artist', 'client'];

class User extends Model {}

function initUser(sequelize) {
  User.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false, validate: { notEmpty: true } },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: 'uq_users_email',
        validate: { isEmail: true },
        set(value) {
          this.setDataValue('email', String(value).trim().toLowerCase());
        },
      },
      password_hash: { type: DataTypes.CHAR(60), allowNull: false },
      role: { type: DataTypes.ENUM(...ROLES), allowNull: false },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      // The hash never leaves the data layer unless explicitly requested.
      defaultScope: { attributes: { exclude: ['password_hash'] } },
      scopes: { withPassword: { attributes: { include: ['password_hash'] } } },
    },
  );
  return User;
}

module.exports = { User, initUser, ROLES };
