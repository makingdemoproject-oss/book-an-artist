'use strict';

const AppError = require('../utils/AppError');

/**
 * Validates and replaces req[source] with the parsed zod output.
 * Produces a single human-readable message, e.g. "event_start: Required; notes: Required".
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return next(AppError.badRequest(message));
  }
  // req.query is a getter in Express 5, so store parsed values separately.
  req.validated = { ...(req.validated || {}), [source]: result.data };
  return next();
};

module.exports = validate;
