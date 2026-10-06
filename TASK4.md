# Task 4 — System Design: `GET /artists/search` timing out at 50k users

## 1. The two most likely causes, and what I'd check first

**a) Unindexed or non-sargable queries.** At 50× the data, full table scans saturate the CPU: `name LIKE '%term%'`, filtering on `category`/`city` with no index, or `ORDER BY rating` with a filesort.

**b) Too much work per request.** N+1 queries (one query per artist for ratings), averages computed live with `AVG()` over reviews, or no `LIMIT`.

**What I'd check first:** the slow query log and `performance_schema.events_statements_summary_by_digest`, sorted by total latency. Then I'd run `EXPLAIN ANALYZE` on the worst statement and look for `type: ALL` or `Using filesort`. APM traces show how many SQL calls one search makes.

## 2. The 48-hour fix

1. **Add the missing composite and `FULLTEXT` indexes online** (`ALGORITHM=INPLACE, LOCK=NONE`), replace `LIKE '%x%'` with `MATCH … AGAINST`, and cap the page size. No downtime is needed.
2. **Cache search results in Redis** with a 60-second TTL, keyed on the normalised query plus page. Popular queries dominate traffic, so the hit rate is high and MySQL load drops immediately. Also store `avg_rating` as a precomputed column so search stops aggregating reviews.

## 3. The long-term fix

Move search into a dedicated engine (OpenSearch), fed from MySQL through change data capture (Debezium) or a transactional outbox. Add read replicas for the remaining reads. MySQL then handles only transactional work.

**Trade-off:** search becomes eventually consistent, so new artists and ratings appear seconds later instead of immediately. We also take on another system to run, monitor, re-index and pay for.
