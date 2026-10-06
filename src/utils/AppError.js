'use strict';

/** An expected, client-facing error. Anything else is treated as a 500. */
class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }

  static badRequest(msg) { return new AppError(400, msg); }
  static unauthorized(msg = 'Unauthorized') { return new AppError(401, msg); }
  static forbidden(msg = 'Forbidden') { return new AppError(403, msg); }
  static notFound(msg = 'Not found') { return new AppError(404, msg); }
  static conflict(msg) { return new AppError(409, msg); }
  static unprocessable(msg) { return new AppError(422, msg); }
}

module.exports = AppError;
