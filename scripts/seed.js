'use strict';

/**
 * Resets and seeds local demo data in MySQL (via Sequelize models) and MongoDB.
 * Every seeded account uses the password from SEED_PASSWORD (see .env.example).
 */
const bcrypt = require('bcrypt');
const config = require('../src/config/env');
const { sequelize, User, Booking, Payment } = require('../src/models/sql');
const { connectMongo, disconnectMongo } = require('../src/db/mongo');
const ArtistProfile = require('../src/models/mongo/ArtistProfile');
const Review = require('../src/models/mongo/Review');
const { migrate } = require('./migrate');
const { resetMysql } = require('./resetMysql');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const daysFromNow = (d, hour = 18) => {
  const date = new Date(Date.now() + d * DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

const ARTISTS = [
  { name: 'Aarav Mehta', email: 'aarav@artist.test', category: 'Singer', city: 'Mumbai', hourlyRate: 15000, genres: ['Bollywood', 'Sufi'] },
  { name: 'Diya Sharma', email: 'diya@artist.test', category: 'DJ', city: 'Bengaluru', hourlyRate: 12000, genres: ['House', 'Techno'] },
  { name: 'Kabir Rao', email: 'kabir@artist.test', category: 'Stand-up Comedian', city: 'Delhi', hourlyRate: 20000, genres: ['Observational'] },
  { name: 'Meera Iyer', email: 'meera@artist.test', category: 'Dancer', city: 'Chennai', hourlyRate: 10000, genres: ['Bharatanatyam', 'Contemporary'] },
];

const CLIENTS = [
  { name: 'Rohan Gupta', email: 'rohan@client.test' },
  { name: 'Priya Nair', email: 'priya@client.test' },
  { name: 'Vikram Singh', email: 'vikram@client.test' },
];

// Per artist: scores for completed, reviewed bookings (one booking per score).
const COMPLETED_SCORES = [
  [5, 5, 4, 5, 4, 5, 3],
  [4, 4, 5, 3, 4, 5],
  [5, 4, 2, 5, 3],
  [5, 3, 4],
];

const COMMENTS = {
  1: 'Very disappointing.',
  2: 'Below expectations.',
  3: 'Decent performance.',
  4: 'Great show, guests loved it.',
  5: 'Absolutely outstanding!',
};

async function seed() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('Set SEED_PASSWORD in .env before seeding');

  await migrate();
  await connectMongo();
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

  await resetMysql();
  await Promise.all([ArtistProfile.deleteMany({}), Review.deleteMany({})]);

  const artists = await User.bulkCreate(
    ARTISTS.map((a) => ({ name: a.name, email: a.email, password_hash: passwordHash, role: 'artist' })),
  );
  const clients = await User.bulkCreate(
    CLIENTS.map((c) => ({ name: c.name, email: c.email, password_hash: passwordHash, role: 'client' })),
  );

  await ArtistProfile.insertMany(
    ARTISTS.map((a, i) => ({
      userId: artists[i].id,
      name: a.name,
      category: a.category,
      city: a.city,
      hourlyRate: a.hourlyRate,
      genres: a.genres,
      bio: `${a.name} is a ${a.category.toLowerCase()} based in ${a.city}.`,
    })),
  );

  const reviews = [];
  for (let i = 0; i < artists.length; i += 1) {
    const artistId = artists[i].id;

    // Completed past bookings, each with a payment and a review.
    for (let j = 0; j < COMPLETED_SCORES[i].length; j += 1) {
      const score = COMPLETED_SCORES[i][j];
      const clientId = clients[j % clients.length].id;
      const start = daysFromNow(-(5 + j * 9));
      const booking = await Booking.create({
        artist_id: artistId, client_id: clientId, status: 'completed',
        event_start: start, event_end: new Date(start.getTime() + 3 * HOUR), notes: 'Private event',
      });
      await Payment.create({ booking_id: booking.id, amount: ARTISTS[i].hourlyRate * 3, status: 'succeeded' });
      reviews.push({
        bookingId: booking.id, artistId, clientId, score, comment: COMMENTS[score],
        createdAt: new Date(start.getTime() + 6 * HOUR),
      });
    }

    // A cancelled booking that (incorrectly) has a review — must be excluded by the API.
    const cancelledStart = daysFromNow(-3);
    const cancelled = await Booking.create({
      artist_id: artistId, client_id: clients[0].id, status: 'cancelled', cancelled_by: 'client',
      event_start: cancelledStart, event_end: new Date(cancelledStart.getTime() + 2 * HOUR),
      notes: 'Cancelled by client',
    });
    reviews.push({
      bookingId: cancelled.id, artistId, clientId: clients[0].id, score: 1,
      comment: 'Review on a cancelled booking (should never be shown)', createdAt: new Date(),
    });

    // Upcoming bookings to exercise the state machine.
    const confirmedStart = daysFromNow(10 + i);
    await Booking.create({
      artist_id: artistId, client_id: clients[1].id, status: 'confirmed',
      event_start: confirmedStart, event_end: new Date(confirmedStart.getTime() + 3 * HOUR),
      notes: 'Wedding sangeet',
    });
    const pendingStart = daysFromNow(20 + i);
    await Booking.create({
      artist_id: artistId, client_id: clients[2].id, status: 'pending',
      event_start: pendingStart, event_end: new Date(pendingStart.getTime() + 2 * HOUR),
      notes: 'Corporate party',
    });
  }

  // Raw insert preserves explicit createdAt values for realistic "most recent first" ordering.
  await Review.collection.insertMany(reviews.map((r) => ({ ...r, updatedAt: r.createdAt })));
  await Promise.all([Review.syncIndexes(), ArtistProfile.syncIndexes()]);

  console.log('Seed complete.');
  console.log('  Artists :', artists.map((a) => `${a.email} (id ${a.id})`).join(', '));
  console.log('  Clients :', clients.map((c) => `${c.email} (id ${c.id})`).join(', '));
  console.log('  Password: value of SEED_PASSWORD in your .env');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([sequelize.close(), disconnectMongo()]);
  });
