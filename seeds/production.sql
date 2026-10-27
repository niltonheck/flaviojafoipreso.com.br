-- Immutable once votes exist: never UPDATE question/dates; create a new poll instead.
-- 2026-10-27 00:00 -03:00  ->  2026-10-27T03:00:00Z ;  2027-10-27 23:59:59 -03:00  ->  2027-10-28T02:59:59Z
INSERT OR IGNORE INTO polls (id, question, starts_at, closes_at, created_at) VALUES (
  'arrest-by-2027-10-27',
  'Você acha que Flávio Bolsonaro será preso até 27/10/2027?',
  '2026-10-27T03:00:00.000Z',
  '2027-10-28T02:59:59.000Z',
  '2026-10-27T12:00:00.000Z'
);
