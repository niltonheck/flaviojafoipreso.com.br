-- Fake poll id so staging/local data can never be confused with production.
INSERT OR IGNORE INTO polls (id, question, starts_at, closes_at, created_at) VALUES (
  'staging-arrest-by-2027-10-27',
  'Você acha que Flávio Bolsonaro será preso até 27/10/2027?',
  '2026-01-01T03:00:00.000Z',
  '2027-10-28T02:59:59.000Z',
  '2026-10-27T12:00:00.000Z'
);

-- Same change as production (see seeds/production.sql). Starts after the old staging poll so it is the current one.
INSERT OR IGNORE INTO polls (id, question, starts_at, closes_at, created_at) VALUES (
  'staging-arrest-today',
  'Você acha que Flávio Bolsonaro será preso hoje?',
  '2026-01-02T03:00:00.000Z',
  '2027-10-28T02:59:59.000Z',
  '2026-10-28T03:00:00.000Z'
);
