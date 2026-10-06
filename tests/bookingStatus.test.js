'use strict';

const request = require('supertest');
const bcrypt = require('bcrypt');
const { createApp } = require('../src/app');
const { sequelize, User, Booking, BookingStatusHistory } = require('../src/models/sql');
const { resetMysql } = require('../scripts/resetMysql');

const app = createApp();
const PASSWORD = 'integration-test-pw';

async function createUser(name, email, role) {
  const user = await User.create({ name, email, role, password_hash: await bcrypt.hash(PASSWORD, 4) });
  return user.id;
}

async function login(email) {
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

const inDays = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();

describe('PATCH /bookings/:id/status — state machine', () => {
  let artistId;
  let artistToken;
  let clientToken;
  let bookingId;

  beforeAll(async () => {
    await resetMysql();
    artistId = await createUser('Test Artist', 'artist@test.local', 'artist');
    await createUser('Test Client', 'client@test.local', 'client');
    artistToken = await login('artist@test.local');
    clientToken = await login('client@test.local');
  });

  beforeEach(async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ artist_id: artistId, event_start: inDays(7), event_end: inDays(7.1), notes: 'Birthday party' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    bookingId = res.body.data.id;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('returns 422 with a descriptive error for an invalid transition (pending -> completed)', async () => {
    const res = await request(app)
      .patch(`/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: expect.stringContaining("Invalid status transition from 'pending' to 'completed'"),
    });

    // The booking must be left untouched.
    const booking = await Booking.findByPk(bookingId);
    expect(booking.status).toBe('pending');
  });

  it('returns 422 when moving out of a terminal status (cancelled -> confirmed)', async () => {
    await request(app)
      .patch(`/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    const res = await request(app)
      .patch(`/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${artistToken}`)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/terminal status/);
  });

  it('allows the full happy path for the assigned artist and records history', async () => {
    for (const status of ['confirmed', 'in_progress', 'completed']) {
      const res = await request(app)
        .patch(`/bookings/${bookingId}/status`)
        .set('Authorization', `Bearer ${artistToken}`)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, error: null, data: { status } });
    }

    const history = await BookingStatusHistory.findAll({
      where: { booking_id: bookingId },
      order: [['id', 'ASC']],
      raw: true,
    });
    expect(history.map((h) => h.to_status)).toEqual(['pending', 'confirmed', 'in_progress', 'completed']);
  });

  it('forbids a client from confirming (clients may only cancel)', async () => {
    const res = await request(app)
      .patch(`/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ status: 'confirmed' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
