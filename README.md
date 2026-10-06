# Book an Artist — Backend API

A REST API for booking artists, built with Node.js and Express.

| Store   | Holds | Why |
|---------|-------|-----|
| **MySQL**   | users, bookings, booking status history, payments | Relational and transactional: foreign keys, row locks for double-booking protection, money as `DECIMAL` |
| **MongoDB** | artist profiles, reviews | Document-shaped and read-heavy; `$facet` computes the review summary and a page of reviews in one round trip |

Authentication uses stateless JWTs (`Authorization: Bearer <token>`) with no sessions or cookies.

Other submission documents: [TASK3.md](TASK3.md) covers the SQL leaderboard and schema audit, and [TASK4.md](TASK4.md) covers the system design.

---

## Running locally

**Prerequisites:** Node.js 18 or later, MySQL 8, and MongoDB 6 or later. Both databases can run locally. `MONGO_URI` can also point to an Atlas cluster.

```bash
git clone https://github.com/makingdemoproject-oss/book-an-artist.git
cd book-an-artist
npm install

cp .env.example .env      # then set MYSQL_PASSWORD, JWT_SECRET, MONGO_URI, SEED_PASSWORD
npm run setup             # creates the MySQL database and tables, then seeds MySQL and MongoDB
npm start                 # http://localhost:3000

npm test                  # integration tests (uses a separate <db>_test MySQL database)
```

To generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Seeded accounts

Every account's password is whatever you set as `SEED_PASSWORD` in `.env`.

| Role   | Emails |
|--------|--------|
| artist | `aarav@artist.test`, `diya@artist.test`, `kabir@artist.test`, `meera@artist.test` |
| client | `rohan@client.test`, `priya@client.test`, `vikram@client.test` |

The seed prints each user's ID. Every artist starts with completed and reviewed bookings, one upcoming `confirmed` booking and one `pending` booking. Each artist also has one **cancelled booking with a review attached**, which shows that the reviews endpoint excludes reviews from bookings that are not completed.

---

## API

Every response has the same shape:

```json
{ "success": true,  "data": { ... }, "error": null }
{ "success": false, "data": null,    "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Malformed input (validation failed, bad JSON) |
| 401 | Missing, invalid or expired token; wrong credentials |
| 403 | Authenticated but not allowed (wrong role, not your booking) |
| 404 | Resource not found |
| 409 | Conflict: the artist already has an overlapping confirmed booking |
| 422 | Business-rule violation: invalid state transition, `event_start` in the past |

### `POST /auth/login`

```bash
curl -X POST localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"rohan@client.test","password":"<SEED_PASSWORD>"}'
```

Returns `{ token, tokenType, expiresIn, user }`. The JWT payload is `{ sub: <userId>, role: 'artist'|'client', iat, exp }`. A wrong email and a wrong password both return the same `401 Invalid email or password`. When the email doesn't exist, a bcrypt comparison still runs against a dummy hash, so response timing doesn't reveal whether an account exists. Login is rate-limited to 20 attempts per 15 minutes.

### `POST /bookings` (client only)

```bash
curl -X POST localhost:3000/bookings -H "Authorization: Bearer $CLIENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"artist_id":1,"event_start":"2026-12-20T18:00:00Z","event_end":"2026-12-20T21:00:00Z","notes":"Wedding reception"}'
```

- Dates must be ISO-8601 with a timezone. They are stored in UTC.
- Returns `422` if `event_start` is in the past or `event_end <= event_start`.
- Returns `409` if the artist already has a **confirmed** booking overlapping `[event_start, event_end)`.
- Creates the booking with status `pending` and returns `201`.

### `PATCH /bookings/:id/status` (artist or client)

```bash
curl -X PATCH localhost:3000/bookings/5/status -H "Authorization: Bearer $ARTIST_TOKEN" \
  -H "Content-Type: application/json" -d '{"status":"confirmed"}'
```

```
pending     -> confirmed     artist
confirmed   -> in_progress   artist
in_progress -> completed     artist
pending     -> cancelled     artist or client
confirmed   -> cancelled     artist or client
anything else                422 + "Invalid status transition from 'x' to 'y'. Allowed transitions from 'x': ..."
```

Checks run in this order:

1. The booking exists (`404`).
2. The caller owns it: the artist it's assigned to, or the client who made it (`403`).
3. The transition exists in the state machine (`422`).
4. The caller's role may make that transition, for example clients may only cancel (`403`).
5. When confirming, the booking doesn't overlap another confirmed booking for the artist (`409`).

Every transition is written to `booking_status_history`.

### `GET /artists/:id/reviews?page=1&limit=10` (public)

```json
{
  "success": true,
  "data": {
    "artist": { "id": 1, "name": "Aarav Mehta" },
    "summary": { "averageScore": 4.43, "totalCount": 7, "distribution": { "1": 0, "2": 0, "3": 1, "4": 2, "5": 4 } },
    "reviews": [ { "id": "...", "bookingId": 3, "clientId": 5, "score": 5, "comment": "...", "createdAt": "..." } ],
    "pagination": { "page": 1, "limit": 10, "total": 7, "totalPages": 1 }
  },
  "error": null
}
```

Only reviews whose booking is `completed` are included. Reviews are sorted newest first. `limit` is capped at 100.

---

## Project structure

```
src/
  app.js                 Express app factory (imported by tests without opening a port)
  server.js              Connects both databases, starts HTTP, graceful shutdown
  config/env.js          Loads and validates environment variables
  db/                    mysql2 pool + transaction helper, mongoose connection
  middleware/            JWT auth + role guard, zod validation, error handler
  models/                Mongoose models: ArtistProfile, Review
  modules/
    auth/                routes -> controller -> service (+ validation)
    bookings/            routes -> controller -> service, bookingStateMachine.js
    artists/             routes -> controller -> reviews service
  utils/                 AppError, response helpers
db/schema.sql            MySQL schema (idempotent)
db/leaderboard.sql       Task 3A query
scripts/                 migrate.js, seed.js
tests/                   Supertest integration tests against a real MySQL test database
```

Each module follows **routes → controller → service**:

- **Routes** wire up middleware: auth, role checks and validation.
- **Controllers** translate between HTTP and the service layer and know nothing about SQL.
- **Services** hold the business rules and all database access.

---

## Decisions

- **The state machine is a single declarative table** ([bookingStateMachine.js](src/modules/bookings/bookingStateMachine.js)) that maps each transition to the roles allowed to make it. Validation, error messages and permissions all come from that table, so adding a transition is a one-line change.
- **Double-booking is prevented with row locks, not just a `SELECT` check.** Creating a booking and confirming a booking both run in a transaction that first takes `SELECT … FOR UPDATE` on the artist's row. Concurrent requests for the same artist are therefore serialised, and two overlapping bookings can't both pass the check. Locks are always taken in the order artist row, then booking row, which avoids deadlocks. The overlap check is also repeated at **confirm** time, because overlap only matters among confirmed bookings: two pending requests for the same slot are legal, but only one can be confirmed.
- **409 vs 422.** A `422` means the request breaks a business rule (bad transition, date in the past). A `409` means it conflicts with the current state of another resource (an overlapping booking).
- **Validation with zod** returns readable `400` messages, and handlers receive typed, coerced values.
- **Integration tests use a real MySQL database** (`<db>_test`), not mocks. Transactions, row locks, `ENUM`s and `CHECK` constraints are part of the behaviour under test.
- **Security:** helmet, a 100 kB JSON body limit, HS256 pinned when verifying tokens, internals never leaked in 500 responses, parameterised SQL everywhere, and secrets only in `.env`, which git ignores.

## Trade-offs

- **Reviews in MongoDB, booking status in MySQL.** Filtering to completed bookings needs data from both. The service fetches the artist's completed booking IDs from MySQL and passes them to Mongo as a `$in` filter. That is simple and always correct, but the ID list grows with each artist's history. At scale I'd denormalise `bookingStatus` onto each review document, updated by an event when a booking is completed or cancelled. Reads would then be a single indexed Mongo query, at the cost of eventual consistency.
- **No refresh tokens.** Access tokens last `JWT_EXPIRES_IN` (default 1 h) and can't be revoked before they expire. In production I'd add short-lived access tokens with rotating refresh tokens, plus a `token_version` check for revocation.
- **`confirmed → in_progress` isn't time-gated.** The spec only defines the state machine. A real system would reject starting an event before `event_start`, with some tolerance.
- **The leaderboard is delivered as SQL** ([db/leaderboard.sql](db/leaderboard.sql)) against the assignment's schema, as Task 3 asks. It is not wired up as an endpoint, because reviews live in MongoDB in this app.

## What I'd do next

- Endpoints to create reviews (client only, once per completed booking) and to list "my bookings".
- Wire `GET /artists/leaderboard` to a Mongo aggregation, cached in Redis as described in TASK3.
- Versioned migrations (Knex or Umzug) instead of one idempotent schema file.
- Structured logging (pino) with request IDs, OpenAPI docs, Docker Compose for MySQL and MongoDB, and CI running `npm test`.
- More tests: overlap conflicts under concurrency, login, and reviews pagination and summary.
