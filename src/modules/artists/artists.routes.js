'use strict';

const express = require('express');
const validate = require('../../middleware/validate');
const { artistIdParamSchema, paginationSchema } = require('./artists.validation');
const artistsController = require('./artists.controller');

const router = express.Router();

// Public: reviews are shown on an artist's public profile.
router.get(
  '/:id/reviews',
  validate(artistIdParamSchema, 'params'),
  validate(paginationSchema, 'query'),
  artistsController.getArtistReviews,
);

module.exports = router;
