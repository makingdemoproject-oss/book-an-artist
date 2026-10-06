'use strict';

const { Op } = require('sequelize');
const { withTransaction } = require('../../db/sequelize');
const { User, Booking, BookingStatusHistory } = require('../../models/sql');
const AppError = require('../../utils/AppError');
const sm = require('./bookingStateMachine');

/**
 * Locks the artist's user row for the rest of the transaction (SELECT … FOR UPDATE).
 *
 * Every write that can create a confirmed booking for an artist takes this lock first, so two
 * concurrent requests cannot both pass the overlap check and double-book the artist.
 * Locking the artist row (rather than a gap/range lock on bookings) keeps the lock order
 * simple — artist row, then booking row — which avoids deadlocks.
 */
async function lockArtist(artistId, t) {
  const artist = await User.findOne({
    where: { id: artistId, role: 'artist' },
    attributes: ['id'],
    lock: t.LOCK.UPDATE,
    transaction: t,
  });
  return Boolean(artist);
}

/**
 * Half-open interval overlap: [aStart, aEnd) overlaps [bStart, bEnd) iff aStart < bEnd AND aEnd > bStart.
 * Served by idx_bookings_artist_status_start (artist_id, status, event_start).
 */
function findConfirmedOverlap({ artistId, start, end, excludeBookingId = null }, t) {
  return Booking.findOne({
    where: {
      artist_id: artistId,
      status: 'confirmed',
      event_start: { [Op.lt]: end },
      event_end: { [Op.gt]: start },
      ...(excludeBookingId ? { id: { [Op.ne]: excludeBookingId } } : {}),
    },
    attributes: ['id'],
    transaction: t,
  });
}

function recordHistory({ bookingId, from, to, userId }, t) {
  return BookingStatusHistory.create(
    { booking_id: bookingId, from_status: from, to_status: to, changed_by: userId },
    { transaction: t },
  );
}

async function createBooking(client, { artist_id: artistId, event_start: start, event_end: end, notes }) {
  if (start.getTime() <= Date.now()) {
    throw AppError.unprocessable('event_start must be in the future');
  }
  if (end.getTime() <= start.getTime()) {
    throw AppError.unprocessable('event_end must be after event_start');
  }

  return withTransaction(async (t) => {
    if (!(await lockArtist(artistId, t))) throw AppError.notFound(`Artist ${artistId} not found`);

    const clash = await findConfirmedOverlap({ artistId, start, end }, t);
    if (clash) {
      throw AppError.conflict('Artist already has a confirmed booking that overlaps this time window');
    }

    const booking = await Booking.create(
      { artist_id: artistId, client_id: client.id, status: 'pending', event_start: start, event_end: end, notes },
      { transaction: t },
    );
    await recordHistory({ bookingId: booking.id, from: null, to: 'pending', userId: client.id }, t);

    // Reload so the response has every column (DB defaults included), same shape as PATCH.
    await booking.reload({ transaction: t });
    return booking.toJSON();
  });
}

async function updateBookingStatus(user, bookingId, toStatus) {
  return withTransaction(async (t) => {
    // Unlocked read only to learn the artist, so locks can be taken in a consistent order.
    const peek = await Booking.findByPk(bookingId, { attributes: ['artist_id'], transaction: t });
    if (!peek) throw AppError.notFound(`Booking ${bookingId} not found`);

    await lockArtist(peek.artist_id, t);
    const booking = await Booking.findByPk(bookingId, { lock: t.LOCK.UPDATE, transaction: t });

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
      const clash = await findConfirmedOverlap(
        {
          artistId: booking.artist_id,
          start: booking.event_start,
          end: booking.event_end,
          excludeBookingId: booking.id,
        },
        t,
      );
      if (clash) {
        throw AppError.conflict(`Cannot confirm: overlaps with confirmed booking ${clash.id} for this artist`);
      }
    }

    await booking.update(
      { status: toStatus, cancelled_by: toStatus === 'cancelled' ? user.role : booking.cancelled_by },
      { transaction: t },
    );
    await recordHistory({ bookingId: booking.id, from, to: toStatus, userId: user.id }, t);

    return booking.toJSON();
  });
}

module.exports = { createBooking, updateBookingStatus };
