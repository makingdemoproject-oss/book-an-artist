# Task 3 — SQL & Database

## Task A — Leaderboard query (`GET /artists/leaderboard`)

The query is also saved at [`db/leaderboard.sql`](db/leaderboard.sql). It runs against the schema given in the assignment (`artists`, `bookings`, `reviews`).

```sql
WITH recent_reviews AS (
    SELECT  r.artist_id,
            AVG(r.score) AS avg_score,
            COUNT(*)     AS review_count
    FROM    reviews  r
    JOIN    bookings b
            ON  b.id     = r.booking_id
            AND b.status = 'completed'          -- only reviews from completed bookings count
    WHERE   r.created_at >= NOW() - INTERVAL 90 DAY
    GROUP BY r.artist_id
    HAVING  COUNT(*) >= 5
),
completed_bookings AS (
    SELECT  b.artist_id,
            COUNT(*) AS completed_count
    FROM    bookings b
    WHERE   b.status = 'completed'
      AND   b.artist_id IN (SELECT artist_id FROM recent_reviews)
    GROUP BY b.artist_id
)
SELECT  a.id                              AS artist_id,
        a.name                            AS artist_name,
        a.category,
        ROUND(rr.avg_score, 2)            AS average_score,
        rr.review_count                   AS total_reviews,
        COALESCE(cb.completed_count, 0)   AS total_completed_bookings
FROM    recent_reviews rr
JOIN    artists a                ON a.id = rr.artist_id
LEFT JOIN completed_bookings cb  ON cb.artist_id = rr.artist_id
ORDER BY average_score DESC,
         total_completed_bookings DESC,
         a.id ASC
LIMIT 10;
```

**Why it is structured this way**

- **Reviews and completed bookings are aggregated in separate CTEs.** If you join `reviews → bookings` and then count both in one `GROUP BY`, the counts multiply each other (an N×M fan-out) and both numbers come out inflated. Aggregating each one on its own, then joining one row per artist, avoids that.
- **The 5-review threshold is applied with `HAVING`, before joining to `artists`.** Only qualifying artists are carried forward, and the second CTE counts bookings only for those artists.
- **The sort uses the rounded average.** Two artists showing `4.67` are treated as tied, so the completed-booking count decides the order, as the spec asks. `a.id` is a final deterministic tiebreak, so results don't shuffle between requests.

**Assumptions**

- A review counts only if its booking is `completed`. This matches the rule used by `GET /artists/:id/reviews`.
- "Total completed booking count" means the artist's completed bookings over all time. It is a measure of experience, so it is not limited to the 90-day window. To limit it, add `AND b.event_end >= NOW() - INTERVAL 90 DAY` to the second CTE.
- "Last 90 days" is measured on `reviews.created_at`.

### Indexes

```sql
-- 1. Reviews: a range on created_at, then grouping by artist. Covering index, so no table lookups.
CREATE INDEX idx_reviews_created_artist_score
    ON reviews (created_at, artist_id, score, booking_id);

-- 2. Bookings: the completed-count CTE and the status check on the join.
CREATE INDEX idx_bookings_artist_status
    ON bookings (artist_id, status);
```

- **`reviews (created_at, artist_id, score, booking_id)`.** The only selective predicate is the 90-day range, so `created_at` has to come first for MySQL to do a range scan instead of a full scan. The remaining columns make the index *covering*: everything the CTE reads (`artist_id`, `score`, `booking_id`) is in the index, so InnoDB never needs a random primary-key lookup per row. That matters most once the table has millions of rows.
- **`bookings (artist_id, status)`.** This serves `WHERE status = 'completed' AND artist_id IN (...)` as index-only lookups per artist. The join `b.id = r.booking_id` already uses the primary key. In the real application I'd extend it to `(artist_id, status, event_start)`, because the same index then also serves the booking overlap check.
- The obvious `reviews(artist_id)` index doesn't help here: the query looks at *all* artists for a time window, not one artist. A separate `(artist_id, created_at)` index is still worth having for the per-artist reviews endpoint.

### At tens of millions of rows

Don't compute the leaderboard on each request. Precompute it and serve it from a cache.

1. **Incremental rollup table.** Add `artist_review_daily (artist_id, day, review_count, score_sum)`. Update it in the same transaction as the review insert, or from an outbox/queue consumer. The leaderboard then reads at most 90 small rows per artist instead of scanning raw reviews. Storing a sum and a count, not an average, keeps the rollup exact.
2. **Materialised leaderboard plus cache.** A scheduled job (every 5–15 minutes) writes the top-N into a `leaderboard_snapshot` table and into Redis, for example as a sorted set or a JSON blob. The endpoint becomes an O(1) cache read with the snapshot table as fallback.
3. Run the heavy aggregation on a **read replica** so it never competes with booking writes on the primary.

**Trade-off:** the leaderboard is eventually consistent, up to one refresh interval out of date. That is acceptable for a ranking page.

---

## Task B — Schema audit

The schema as given:

```sql
CREATE TABLE artists  (id INT PK AI, name VARCHAR(255), category VARCHAR(255), hourly_rate FLOAT, created_at DATETIME);
CREATE TABLE bookings (id INT PK AI, artist_id INT, client_id INT, status VARCHAR(50), amount FLOAT,
                       event_start DATETIME, event_end DATETIME, created_at DATETIME);
CREATE TABLE reviews  (id INT PK AI, booking_id INT, artist_id INT, score INT, comment TEXT, created_at DATETIME);
```

### 1. No foreign keys: referential integrity is not enforced

**Problem.** `bookings.artist_id`, `bookings.client_id`, `reviews.booking_id` and `reviews.artist_id` are plain `INT`s with no constraint.

**Why it matters.** The database accepts bookings for artists that don't exist and reviews for deleted bookings. These orphan rows silently corrupt joins and aggregates, including the leaderboard above. InnoDB also creates an index for each foreign key, so today even these join columns are unindexed.

**Fix.** Clean up orphan rows first, then add the constraints:

```sql
-- Check for orphan rows before adding constraints
SELECT b.id FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id WHERE a.id IS NULL;

ALTER TABLE bookings
  ADD CONSTRAINT fk_bookings_artist FOREIGN KEY (artist_id) REFERENCES artists (id),
  ADD CONSTRAINT fk_bookings_client FOREIGN KEY (client_id) REFERENCES users (id);   -- clients live in users

ALTER TABLE reviews
  ADD CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings (id);
```

### 2. `FLOAT` used for money

**Problem.** `artists.hourly_rate` and `bookings.amount` are `FLOAT`, a binary floating-point type with roughly 7 significant digits.

**Why it matters.** Most decimal amounts can't be stored exactly in binary floating point. For example, `0.1 + 0.2 ≠ 0.3`, and `1234567.89` gets rounded. Sums, refunds and reconciliation drift by paise, and those discrepancies are hard to trace.

**Fix.**

```sql
ALTER TABLE artists  MODIFY hourly_rate DECIMAL(10,2) NOT NULL;
ALTER TABLE bookings MODIFY amount      DECIMAL(10,2) NOT NULL;
ALTER TABLE artists  ADD CONSTRAINT chk_artists_rate   CHECK (hourly_rate >= 0);
ALTER TABLE bookings ADD CONSTRAINT chk_bookings_amount CHECK (amount >= 0);
```

### 3. `status` is free text and `score` is unbounded: invalid states are possible

**Problem.** `bookings.status VARCHAR(50)` accepts any string, and `reviews.score INT` accepts any integer. Nothing checks that `event_end > event_start`.

**Why it matters.** The booking state machine is the core business rule. With free text, typos such as `'Confirmed'`, `'canceled'` or `'done'` slip in. Overlap checks (`status = 'confirmed'`) and the leaderboard (`status = 'completed'`) then silently skip those rows. A score of `0` or `50` distorts every average. A booking whose end is before its start breaks overlap detection.

**Fix.**

```sql
ALTER TABLE bookings
  MODIFY status ENUM('pending','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  ADD CONSTRAINT chk_bookings_window CHECK (event_end > event_start);

ALTER TABLE reviews
  MODIFY score TINYINT UNSIGNED NOT NULL,
  ADD CONSTRAINT chk_reviews_score CHECK (score BETWEEN 1 AND 5);
```

(A `booking_statuses` lookup table with a foreign key works too, if statuses need to change without DDL.)

### 4. `reviews` allows duplicates and contradicts itself

**Problem.** Nothing stops several reviews for the same booking. `reviews.artist_id` is also a denormalised copy of `bookings.artist_id`, and nothing keeps the two in agreement.

**Why it matters.** One client could post 10 five-star reviews for a single booking and inflate a rating. A review can also claim `artist_id = 7` while its booking belongs to artist 9, so it lands on the wrong artist's profile and leaderboard row.

**Fix.** Allow one review per booking. Then use a composite foreign key so the denormalised `artist_id` *must* match the booking's artist:

```sql
ALTER TABLE reviews  ADD CONSTRAINT uq_reviews_booking UNIQUE (booking_id);

ALTER TABLE bookings ADD CONSTRAINT uq_bookings_id_artist UNIQUE (id, artist_id);
ALTER TABLE reviews
  ADD CONSTRAINT fk_reviews_booking_artist
  FOREIGN KEY (booking_id, artist_id) REFERENCES bookings (id, artist_id);
```

### 5. No indexes on hot query paths, and every column is nullable

**Problem.** The only indexes are the primary keys. Every lookup by artist, status, time window or `created_at` is a full table scan. Required columns (`name`, `artist_id`, `event_start`, `created_at`, …) are all nullable, and `created_at` has no default.

**Why it matters.** The overlap check runs on every booking request and every confirmation, and the reviews and leaderboard queries are high-traffic reads. They all degrade linearly as tables grow. This is exactly the kind of query that drives CPU to 90% (see TASK4). `NULL`s in required columns turn into `NULL` averages, rows that never match `WHERE`, and application crashes.

**Fix.**

```sql
ALTER TABLE artists
  MODIFY name       VARCHAR(255) NOT NULL,
  MODIFY category   VARCHAR(100) NOT NULL,
  MODIFY created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX idx_artists_category (category);

ALTER TABLE bookings
  MODIFY artist_id   INT      NOT NULL,
  MODIFY client_id   INT      NOT NULL,
  MODIFY event_start DATETIME NOT NULL,
  MODIFY event_end   DATETIME NOT NULL,
  MODIFY created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX idx_bookings_artist_status_start (artist_id, status, event_start),   -- overlap check
  ADD INDEX idx_bookings_client_created     (client_id, created_at);             -- "my bookings"

ALTER TABLE reviews
  MODIFY booking_id INT      NOT NULL,
  MODIFY artist_id  INT      NOT NULL,
  MODIFY created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX idx_reviews_artist_created (artist_id, created_at),                  -- artist reviews page
  ADD INDEX idx_reviews_created_artist_score (created_at, artist_id, score, booking_id); -- leaderboard
```

### Smaller issues also worth fixing

- `DATETIME` doesn't record a timezone. Always store UTC and document it, or use `TIMESTAMP`.
- `INT` signed IDs: use `INT UNSIGNED` or `BIGINT UNSIGNED` for high-volume tables such as reviews.
- No `updated_at` columns and no status history, so you can't audit who confirmed or cancelled a booking. This project adds a `booking_status_history` table.
- Declare tables `utf8mb4` explicitly so artist names and comments with emoji or Indic scripts are stored correctly.

All of these fixes are applied in this project's own schema: [`db/schema.sql`](db/schema.sql).
