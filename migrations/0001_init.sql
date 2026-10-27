-- Presômetro schema (SPEC C §5, adapted for one vote per voter per day).
-- Timestamps are ISO 8601 in UTC ("...Z"); `day` is the America/Sao_Paulo calendar day (YYYY-MM-DD).
CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  day TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('yes', 'no')),
  voter_hash TEXT NOT NULL, -- HMAC-SHA256(secret, voter id); the raw id is never stored
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, day, voter_hash)
);

CREATE INDEX votes_poll_day_choice_idx ON votes(poll_id, day, choice);
