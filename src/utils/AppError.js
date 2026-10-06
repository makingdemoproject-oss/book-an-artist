'use strict';

/**
 * An expected, client-facing ("operational") error. Its message is safe to return to the client.
 * Anything that is not an AppError is treated as a bug: logged in full, returned as a generic 500.
 */
class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
  }

  static badRequest(msg) { return new AppError(400, msg); }
  static unauthorized(msg = 'Unauthorized') { return new AppError(401, msg); }
  static forbidden(msg = 'Forbidden') { return new AppError(403, msg); }
  static notFound(msg = 'Not found') { return new AppError(404, msg); }
  static conflict(msg) { return new AppError(409, msg); }
  static unsupportedMediaType(msg = 'Content-Type must be application/json') { return new AppError(415, msg); }
  static unprocessable(msg) { return new AppError(422, msg); }
  static serviceUnavailable(msg = 'Service temporarily unavailable, please retry') { return new AppError(503, msg); }
}

module.exports = AppError;
