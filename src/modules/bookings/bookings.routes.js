'use strict';

const express = require('express');
const validate = require('../../middleware/validate');
const { authenticate, requireRole } = require('../../middleware/auth');
const {
  createBookingSchema,
  bookingIdParamSchema,
  updateStatusSchema,
} = require('./bookings.validation');
const bookingsController = require('./bookings.controller');

const router = express.Router();

router.post(
  '/',
  authenticate,
  requireRole('client'),
  validate(createBookingSchema),
  bookingsController.createBooking,
);

router.patch(
  '/:id/status',
  authenticate,
  requireRole('artist', 'client'),
  validate(bookingIdParamSchema, 'params'),
  validate(updateStatusSchema),
  bookingsController.updateBookingStatus,
);

module.exports = router;
