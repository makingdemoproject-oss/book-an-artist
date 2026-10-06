'use strict';

const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { sendError } = require('../utils/response');

// MySQL error codes that represent a client/data problem or a transient condition, not a bug.
const MYSQL_ERRORS = {
  ER_DUP_ENTRY: [409, 'Resource already exists'],
  ER_NO_REFERENCED_ROW_2: [422, 'Referenced resource does not exist'],
  ER_ROW_IS_REFERENCED_2: [409, 'Resource is still referenced by other records'],
  ER_CHECK_CONSTRAINT_VIOLATED: [422, 'Request violates a data constraint'],
  ER_DATA_TOO_LONG: [400, 'A field value is too long'],
  ER_TRUNCATED_WRONG_VALUE: [400, 'A field has an invalid value'],
  ER_LOCK_DEADLOCK: [503, 'Resource is busy, please retry'],
  ER_LOCK_WAIT_TIMEOUT: [503, 'Resource is busy, please retry'],
  ECONNREFUSED: [503, 'Service temporarily unavailable, please retry'],
  PROTOCOL_CONNECTION_LOST: [503, 'Service temporarily unavailable, please retry'],
  ETIMEDOUT: [503, 'Service temporarily unavailable, please retry'],
};

// body-parser error types
const BODY_PARSER_ERRORS = {
  'entity.parse.failed': [400, 'Request body is not valid JSON'],
  'entity.too.large': [413, 'Request body is too large'],
  'encoding.unsupported': [415, 'Unsupported request encoding'],
  'charset.unsupported': [415, 'Unsupported request charset'],
};

/** Maps any thrown value to { status, message }. Unknown errors become a generic 500. */
function normalize(err) {
  if (err instanceof AppError) return { status: err.statusCode, message: err.message };

  if (err && BODY_PARSER_ERRORS[err.type]) {
    const [status, message] = BODY_PARSER_ERRORS[err.type];
    return { status, message };
  }

  // Sequelize (MySQL)
  if (err && err.name === 'SequelizeUniqueConstraintError') return { status: 409, message: 'Resource already exists' };
  if (err && err.name === 'SequelizeForeignKeyConstraintError') {
    return { status: 422, message: 'Referenced resource does not exist' };
  }
  if (err && err.name === 'SequelizeValidationError') {
    return { status: 400, message: err.errors.map((e) => e.message).join('; ') };
  }
  if (err && /^Sequelize\w*(Connection|HostNotFound|HostNotReachable|AccessDenied|ConnectionAcquireTimeout)\w*Error$/.test(err.name)) {
    return { status: 503, message: 'Service temporarily unavailable, please retry' };
  }

  // Raw MySQL error codes (directly, or wrapped by Sequelize in err.parent / err.original)
  const mysqlCode = err && (err.code || (err.parent && err.parent.code) || (err.original && err.original.code));
  if (mysqlCode && MYSQL_ERRORS[mysqlCode]) {
    const [status, message] = MYSQL_ERRORS[mysqlCode];
    return { status, message };
  }

  // Mongoose / MongoDB
  if (err && err.name === 'ValidationError') return { status: 400, message: err.message };
  if (err && err.name === 'CastError') return { status: 400, message: `Invalid value for ${err.path}` };
  if (err && err.code === 11000) return { status: 409, message: 'Resource already exists' };
  if (err && /^Mongo(Network|ServerSelection|NotConnected)Error$|^MongooseServerSelectionError$/.test(err.name)) {
    return { status: 503, message: 'Service temporarily unavailable, please retry' };
  }

  return { status: 500, message: 'Internal server error' };
}

function notFoundHandler(req, res) {
  return sendError(res, 404, `Route ${req.method} ${req.path} not found`);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Response already started streaming: let Express close the connection.
  if (res.headersSent) return next(err);

  const { status, message } = normalize(err);
  const log = req.log || logger;

  if (status >= 500) {
    // Full error (with stack) goes to logs only; the client gets a generic message.
    log.error({ err, status }, 'request failed');
  } else {
    log.info({ status, error: message }, 'request rejected');
  }

  if (status === 503) res.set('Retry-After', '1');
  return sendError(res, status, message);
}

module.exports = { notFoundHandler, errorHandler, normalize };
