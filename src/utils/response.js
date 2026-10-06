'use strict';

// Every endpoint responds with { success, data, error } — see README "Response shape".

function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data, error: null });
}

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, data: null, error: message });
}

/** Wraps an async route handler so rejected promises reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { sendSuccess, sendError, asyncHandler };
