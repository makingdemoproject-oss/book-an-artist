'use strict';

const { sendSuccess, asyncHandler } = require('../../utils/response');
const reviewsService = require('./reviews.service');

const getArtistReviews = asyncHandler(async (req, res) => {
  const data = await reviewsService.getArtistReviews(req.validated.params.id, req.validated.query);
  return sendSuccess(res, data);
});

module.exports = { getArtistReviews };
