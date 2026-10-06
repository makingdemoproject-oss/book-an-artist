'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');
const { pool } = require('../../db/mysql');
const AppError = require('../../utils/AppError');

// Compared against when the email does not exist, so both failure paths cost one bcrypt
// comparison and response timing does not reveal whether an email is registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', config.bcryptRounds);

const INVALID_CREDENTIALS = 'Invalid email or password';

async function login(email, password) {
  const [rows] = await pool.query(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
    [email],
  );
  const user = rows[0];

  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk) {
    throw AppError.unauthorized(INVALID_CREDENTIALS);
  }

  // jsonwebtoken adds `iat` (issued-at) automatically; set explicitly for clarity.
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { sub: String(user.id), role: user.role, iat: issuedAt },
    config.jwt.secret,
    { algorithm: 'HS256', expiresIn: config.jwt.expiresIn },
  );

  return {
    token,
    tokenType: 'Bearer',
    expiresIn: config.jwt.expiresIn,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

module.exports = { login };
