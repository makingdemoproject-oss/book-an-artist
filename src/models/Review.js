'use strict';

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    // One review per booking; IDs reference MySQL rows.
    bookingId: { type: Number, required: true, unique: true },
    artistId: { type: Number, required: true },
    clientId: { type: Number, required: true },
    score: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: 'score must be an integer 1-5' },
    },
    comment: { type: String, default: '' },
  },
  { timestamps: true, collection: 'reviews' },
);

// Serves GET /artists/:id/reviews: filter by artist, sort newest first.
reviewSchema.index({ artistId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
