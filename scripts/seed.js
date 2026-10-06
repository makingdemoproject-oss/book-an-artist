'use strict';

/**
 * Resets and seeds local demo data in MySQL and MongoDB.
 * Every seeded account uses the password from SEED_PASSWORD (see .env.example).
 */
const bcrypt = require('bcrypt');
const config = require('../src/config/env');
const { pool } = require('../src/db/mysql');
const { connectMongo, disconnectMongo } = require('../src/db/mongo');
const ArtistProfile = require('../src/models/ArtistProfile');
const Review = require('../src/models/Review');
const { migrate } = require('./migrate');

const DAY = 24 * 60 * 60 * 1000;
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

async function insertUser(conn, { name, email, role }, passwordHash) {
  const [r] = await conn.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role],
  );
  return r.insertId;
}

async function insertBooking(conn, b) {
  const [r] = await conn.query(
    `INSERT INTO bookings (artist_id, client_id, status, event_start, event_end, notes, cancelled_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [b.artistId, b.clientId, b.status, b.start, b.end, b.notes, b.cancelledBy || null],
  );
  return r.insertId;
}

async function seed() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('Set SEED_PASSWORD in .env before seeding');

  await migrate();
  await connectMongo();
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['payments', 'booking_status_history', 'bookings', 'users']) {
      await conn.query(`TRUNCATE TABLE ${t}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await Promise.all([ArtistProfile.deleteMany({}), Review.deleteMany({})]);

    const artistIds = [];
    for (const a of ARTISTS) {
      const id = await insertUser(conn, { ...a, role: 'artist' }, passwordHash);
      artistIds.push(id);
      await ArtistProfile.create({
        userId: id,
        name: a.name,
        category: a.category,
        city: a.city,
        hourlyRate: a.hourlyRate,
        genres: a.genres,
        bio: `${a.name} is a ${a.category.toLowerCase()} based in ${a.city}.`,
      });
    }

    const clientIds = [];
    for (const c of CLIENTS) clientIds.push(await insertUser(conn, { ...c, role: 'client' }, passwordHash));

    const reviews = [];
    for (let i = 0; i < artistIds.length; i += 1) {
      const artistId = artistIds[i];

      // Completed past bookings, each with a review.
      for (let j = 0; j < COMPLETED_SCORES[i].length; j += 1) {
        const score = COMPLETED_SCORES[i][j];
        const clientId = clientIds[j % clientIds.length];
        const start = daysFromNow(-(5 + j * 9));
        const bookingId = await insertBooking(conn, {
          artistId, clientId, status: 'completed', start, end: new Date(start.getTime() + 3 * 3600e3),
          notes: 'Private event',
        });
        await conn.query('INSERT INTO payments (booking_id, amount, status) VALUES (?, ?, ?)', [
          bookingId, ARTISTS[i].hourlyRate * 3, 'succeeded',
        ]);
        reviews.push({
          bookingId, artistId, clientId, score, comment: COMMENTS[score],
          createdAt: new Date(start.getTime() + 6 * 3600e3),
        });
      }

      // A cancelled booking that (incorrectly) has a review — must be excluded by the API.
      const cancelledStart = daysFromNow(-3);
      const cancelledId = await insertBooking(conn, {
        artistId, clientId: clientIds[0], status: 'cancelled', start: cancelledStart,
        end: new Date(cancelledStart.getTime() + 2 * 3600e3), notes: 'Cancelled by client', cancelledBy: 'client',
      });
      reviews.push({
        bookingId: cancelledId, artistId, clientId: clientIds[0], score: 1,
        comment: 'Review on a cancelled booking (should never be shown)', createdAt: new Date(),
      });

      // Upcoming bookings to exercise the state machine.
      const confirmedStart = daysFromNow(10 + i);
      await insertBooking(conn, {
        artistId, clientId: clientIds[1], status: 'confirmed', start: confirmedStart,
        end: new Date(confirmedStart.getTime() + 3 * 3600e3), notes: 'Wedding sangeet',
      });
      const pendingStart = daysFromNow(20 + i);
      await insertBooking(conn, {
        artistId, clientId: clientIds[2], status: 'pending', start: pendingStart,
        end: new Date(pendingStart.getTime() + 2 * 3600e3), notes: 'Corporate party',
      });
    }

    // Preserve explicit createdAt values for realistic "most recent first" ordering.
    await Review.collection.insertMany(reviews.map((r) => ({ ...r, updatedAt: r.createdAt })));
    await Promise.all([Review.syncIndexes(), ArtistProfile.syncIndexes()]);

    console.log('Seed complete.');
    console.log('  Artists :', ARTISTS.map((a, i) => `${a.email} (id ${artistIds[i]})`).join(', '));
    console.log('  Clients :', CLIENTS.map((c, i) => `${c.email} (id ${clientIds[i]})`).join(', '));
    console.log('  Password: value of SEED_PASSWORD in your .env');
  } finally {
    conn.release();
  }
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([pool.end(), disconnectMongo()]);
  });
