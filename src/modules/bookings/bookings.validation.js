'use strict';

const { z } = require('zod');
const { STATUSES } = require('./bookingStateMachine');

// ISO-8601 with an explicit offset (e.g. 2026-12-01T18:00:00Z) so timezones are never guessed.
const isoDate = z
  .string()
  .datetime({ offset: true, message: 'must be an ISO-8601 datetime with timezone, e.g. 2026-12-01T18:00:00Z' })
  .transform((s) => new Date(s));

const createBookingSchema = z.object({
  artist_id: z.coerce.number().int().positive(),
  event_start: isoDate,
  event_end: isoDate,
  notes: z.string().trim().min(1, 'notes is required').max(2000),
});

const bookingIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const updateStatusSchema = z.object({
  status: z.enum(STATUSES, { message: `status must be one of: ${STATUSES.join(', ')}` }),
});

module.exports = { createBookingSchema, bookingIdParamSchema, updateStatusSchema };
