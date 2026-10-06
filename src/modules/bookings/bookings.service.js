'use strict';

const { withTransaction } = require('../../db/mysql');
const AppError = require('../../utils/AppError');
const sm = require('./bookingStateMachine');

const BOOKING_COLUMNS =
  'id, artist_id, client_id, status, event_start, event_end, notes, cancelled_by, created_at, updated_at';

/**
 * Locks the artist's user row for the rest of the transaction.
 *
 * Every write that can create a confirmed booking for an artist takes this lock first, so two
 * concurrent requests cannot both pass the overlap check and double-book the artist.
 * Locking the artist row (rather than a gap/range lock on bookings) keeps the lock order
 * simple — artist row, then booking row — which avoids deadlocks.
 */
async function lockArtist(conn, artistId) {
  const [rows] = await conn.query(
    "SELECT id FROM users WHERE id = ? AND role = 'artist' FOR UPDATE",
    [artistId],
  );
  return rows.length > 0;
}

/** Half-open interval overlap: [aStart, aEnd) overlaps [bStart, bEnd) iff aStart < bEnd AND aEnd > bStart. */
async function findConfirmedOverlap(conn, { artistId, start, end, excludeBookingId = null }) {
  const [rows] = await conn.query(
    `SELECT id FROM bookings
      WHERE artist_id = ?
        AND status = 'confirmed'
        AND event_start < ?
        AND event_end > ?
        AND (? IS NULL OR id <> ?)
      LIMIT 1`,
    [artistId, end, start, excludeBookingId, excludeBookingId],
  );
  return rows[0] || null;
}

async function getBookingForUpdate(conn, id) {
  const [rows] = await conn.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ? FOR UPDATE`, [id]);
  return rows[0] || null;
}

async function recordHistory(conn, { bookingId, from, to, userId }) {
  await conn.query(
    'INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)',
    [bookingId, from, to, userId],
  );
}

async function createBooking(client, { artist_id: artistId, event_start: start, event_end: end, notes }) {
  if (start.getTime() <= Date.now()) {
    throw AppError.unprocessable('event_start must be in the future');
  }
  if (end.getTime() <= start.getTime()) {
    throw AppError.unprocessable('event_end must be after event_start');
  }

  return withTransaction(async (conn) => {
    const artistExists = await lockArtist(conn, artistId);
    if (!artistExists) throw AppError.notFound(`Artist ${artistId} not found`);

    const clash = await findConfirmedOverlap(conn, { artistId, start, end });
    if (clash) {
      throw AppError.conflict('Artist already has a confirmed booking that overlaps this time window');
    }

    const [result] = await conn.query(
      `INSERT INTO bookings (artist_id, client_id, status, event_start, event_end, notes)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
      [artistId, client.id, start, end, notes],
    );
    await recordHistory(conn, { bookingId: result.insertId, from: null, to: 'pending', userId: client.id });

    const [rows] = await conn.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ?`, [result.insertId]);
    return rows[0];
  });
}

async function updateBookingStatus(user, bookingId, toStatus) {
  return withTransaction(async (conn) => {
    // Unlocked read only to learn the artist, so locks can be taken in a consistent order.
    const [peek] = await conn.query('SELECT artist_id FROM bookings WHERE id = ?', [bookingId]);
    if (!peek.length) throw AppError.notFound(`Booking ${bookingId} not found`);

    await lockArtist(conn, peek[0].artist_id);
    const booking = await getBookingForUpdate(conn, bookingId);

    // 1. Ownership — an artist/client may only touch their own bookings.
    const ownerId = user.role === 'artist' ? booking.artist_id : booking.client_id;
    if (ownerId !== user.id) {
      throw AppError.forbidden(
        user.role === 'artist'
          ? 'You can only update bookings assigned to you'
          : 'You can only update your own bookings',
      );
    }

    // 2. State machine — 422 for any transition that does not exist.
    const from = booking.status;
    if (!sm.isValidTransition(from, toStatus)) {
      throw AppError.unprocessable(sm.describeInvalidTransition(from, toStatus));
    }

    // 3. Role — the transition exists, but this actor may not perform it (e.g. client confirming).
    if (!sm.canActorTransition(user.role, from, toStatus)) {
      throw AppError.forbidden('Clients can only cancel a booking');
    }

    // 4. Confirming must not create a double booking for the artist.
    if (toStatus === 'confirmed') {
      const clash = await findConfirmedOverlap(conn, {
        artistId: booking.artist_id,
        start: booking.event_start,
        end: booking.event_end,
        excludeBookingId: booking.id,
      });
      if (clash) {
        throw AppError.conflict(
          `Cannot confirm: overlaps with confirmed booking ${clash.id} for this artist`,
        );
      }
    }

    await conn.query('UPDATE bookings SET status = ?, cancelled_by = ? WHERE id = ?', [
      toStatus,
      toStatus === 'cancelled' ? user.role : booking.cancelled_by,
      booking.id,
    ]);
    await recordHistory(conn, { bookingId: booking.id, from, to: toStatus, userId: user.id });

    const [rows] = await conn.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ?`, [booking.id]);
    return rows[0];
  });
}

module.exports = { createBooking, updateBookingStatus };
