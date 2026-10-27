-- Retention (docs/API.md): voter codes are only needed to stop a second vote on the same day.
-- A scheduled job rolls each finished day up into these totals and then deletes that day's votes,
-- so no per-voter code outlives its day by more than ~72 hours. Totals are anonymous aggregates.
CREATE TABLE poll_day_totals (
  poll_id TEXT NOT NULL REFERENCES polls(id),
  day TEXT NOT NULL,
  yes INTEGER NOT NULL CHECK (yes >= 0),
  no INTEGER NOT NULL CHECK (no >= 0),
  PRIMARY KEY (poll_id, day)
);
