-- GET /artists/leaderboard
-- Top 10 artists by average review score over the last 90 days (MySQL 8).
-- Written against the schema given in the assignment (artists / bookings / reviews).
-- Explanation, assumptions and index reasoning: see TASK3.md.

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
         a.id ASC                          -- deterministic final tiebreak
LIMIT 10;
