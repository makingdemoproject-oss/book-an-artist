'use strict';

const { User, Booking } = require('../../models/sql');
const Review = require('../../models/mongo/Review');
const AppError = require('../../utils/AppError');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Reviews live in MongoDB, booking status lives in MySQL. We fetch the artist's completed
 * booking IDs from MySQL and use them as a filter in Mongo, so a review attached to a booking
 * that was later cancelled/disputed never counts. See README "Trade-offs" for the scaling note.
 */
async function getArtistReviews(artistId, { page, limit }) {
  // Independent lookups — run them concurrently on separate pool connections.
  const [artist, completed] = await Promise.all([
    User.findOne({ where: { id: artistId, role: 'artist' }, attributes: ['id', 'name'], raw: true }),
    // Covered by idx_bookings_artist_status_start (artist_id, status, …) — index-only scan.
    Booking.findAll({ where: { artist_id: artistId, status: 'completed' }, attributes: ['id'], raw: true }),
  ]);
  if (!artist) throw AppError.notFound(`Artist ${artistId} not found`);

  const match = { artistId, bookingId: { $in: completed.map((b) => b.id) } };
  const skip = (page - 1) * limit;

  // One round trip: summary, distribution and the requested page are computed together.
  const [result] = await Review.aggregate([
    { $match: match },
    {
      $facet: {
        summary: [{ $group: { _id: null, average: { $avg: '$score' }, total: { $sum: 1 } } }],
        distribution: [{ $group: { _id: '$score', count: { $sum: 1 } } }],
        items: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              id: '$_id',
              bookingId: 1,
              clientId: 1,
              score: 1,
              comment: 1,
              createdAt: 1,
            },
          },
        ],
      },
    },
  ]);

  const summaryRow = result.summary[0];
  const total = summaryRow ? summaryRow.total : 0;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const { _id: score, count } of result.distribution) distribution[score] = count;

  return {
    artist: { id: artist.id, name: artist.name },
    summary: {
      averageScore: summaryRow ? round2(summaryRow.average) : 0,
      totalCount: total,
      distribution,
    },
    reviews: result.items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

module.exports = { getArtistReviews };
