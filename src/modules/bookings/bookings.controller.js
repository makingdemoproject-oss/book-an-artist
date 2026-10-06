'use strict';

const { sendSuccess, asyncHandler } = require('../../utils/response');
const bookingsService = require('./bookings.service');

const createBooking = asyncHandler(async (req, res) => {
  const booking = await bookingsService.createBooking(req.user, req.validated.body);
  return sendSuccess(res, booking, 201);
});

const updateBookingStatus = asyncHandler(async (req, res) => {
  const booking = await bookingsService.updateBookingStatus(
    req.user,
    req.validated.params.id,
    req.validated.body.status,
  );
  return sendSuccess(res, booking);
});

module.exports = { createBooking, updateBookingStatus };
