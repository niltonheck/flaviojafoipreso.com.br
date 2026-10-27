-- Fake poll id so staging/local data can never be confused with production.
INSERT OR IGNORE INTO polls (id, question, starts_at, closes_at, created_at) VALUES (
  'staging-arrest-by-2027-10-27',
  'Você acha que Flávio Bolsonaro será preso até 27/10/2027?',
  '2026-01-01T03:00:00.000Z',
  '2027-10-28T02:59:59.000Z',
  '2026-10-27T12:00:00.000Z'
);
