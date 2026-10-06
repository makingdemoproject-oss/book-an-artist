'use strict';

const { pool } = require('../../db/mysql');
const Review = require('../../models/Review');
const AppError = require('../../utils/AppError');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Reviews live in MongoDB, booking status lives in MySQL. We fetch the artist's completed
 * booking IDs from MySQL and use them as a filter in Mongo, so a review attached to a booking
 * that was later cancelled/disputed never counts. See README "Trade-offs" for the scaling note.
 */
async function getArtistReviews(artistId, { page, limit }) {
  const [artistRows] = await pool.query(
    "SELECT id, name FROM users WHERE id = ? AND role = 'artist'",
    [artistId],
  );
  if (!artistRows.length) throw AppError.notFound(`Artist ${artistId} not found`);

  const [completed] = await pool.query(
    "SELECT id FROM bookings WHERE artist_id = ? AND status = 'completed'",
    [artistId],
  );
  const completedBookingIds = completed.map((r) => r.id);

  const match = { artistId, bookingId: { $in: completedBookingIds } };
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
    artist: { id: artistRows[0].id, name: artistRows[0].name },
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
