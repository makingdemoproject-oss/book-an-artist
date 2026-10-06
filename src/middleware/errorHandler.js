'use strict';

const AppError = require('../utils/AppError');
const { sendError } = require('../utils/response');

function notFoundHandler(req, res) {
  return sendError(res, 404, `Route ${req.method} ${req.originalUrl} not found`);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.message);
  }

  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'Request body is not valid JSON');
  }

  // Never leak internals (SQL, stack traces) to the client.
  console.error('[unhandled]', err);
  return sendError(res, 500, 'Internal server error');
}

module.exports = { notFoundHandler, errorHandler };
