import type { Choice, D1Like, PollState } from './types.ts';

export type PollRow = { id: string; question: string; starts_at: string; closes_at: string };

/** The latest poll that has started, or the earliest upcoming one. */
export async function currentPoll(db: D1Like, now: Date): Promise<PollRow | null> {
  const started = await db
    .prepare('SELECT id, question, starts_at, closes_at FROM polls WHERE starts_at <= ? ORDER BY starts_at DESC LIMIT 1')
    .bind(now.toISOString())
    .first<PollRow>();
  if (started) return started;
  return db.prepare('SELECT id, question, starts_at, closes_at FROM polls ORDER BY starts_at ASC LIMIT 1').first<PollRow>();
}

export function pollState(p: PollRow, now: Date): PollState {
  if (now.getTime() < Date.parse(p.starts_at)) return 'upcoming';
  if (now.getTime() > Date.parse(p.closes_at)) return 'closed';
  return 'open';
}

/** Calendar day (YYYY-MM-DD) in Brasília time; this is the unit of "one vote per day". */
export function brasiliaDay(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export type Tally = { yes: number; no: number };

/** Counts come from persisted votes. `day` null = whole poll (used once it has closed). */
export async function tally(db: D1Like, pollId: string, day: string | null): Promise<Tally> {
  const stmt = day === null
    ? db.prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY choice').bind(pollId)
    : db.prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE poll_id = ? AND day = ? GROUP BY choice').bind(pollId, day);
  const { results } = await stmt.all<{ choice: Choice; n: number }>();
  const t: Tally = { yes: 0, no: 0 };
  for (const r of results) t[r.choice] = Number(r.n);
  if (day === null) {
    // Whole poll: days already rolled up live in poll_day_totals; add them to the not-yet-purged votes.
    const rolled = await db.prepare('SELECT COALESCE(SUM(yes), 0) AS yes, COALESCE(SUM(no), 0) AS no FROM poll_day_totals WHERE poll_id = ?')
      .bind(pollId).first<{ yes: number; no: number }>();
    t.yes += Number(rolled?.yes ?? 0);
    t.no += Number(rolled?.no ?? 0);
  }
  return t;
}

export async function viewerChoice(db: D1Like, pollId: string, day: string, hash: string): Promise<Choice | null> {
  const row = await db
    .prepare('SELECT choice FROM votes WHERE poll_id = ? AND day = ? AND voter_hash = ?')
    .bind(pollId, day, hash)
    .first<{ choice: Choice }>();
  return row?.choice ?? null;
}

/** Atomic via the UNIQUE(poll_id, day, voter_hash) constraint; never a read-then-write. */
export async function insertVote(
  db: D1Like,
  v: { pollId: string; day: string; choice: Choice; hash: string; now: Date },
): Promise<'created' | 'duplicate'> {
  try {
    await db
      .prepare('INSERT INTO votes (id, poll_id, day, choice, voter_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), v.pollId, v.day, v.choice, v.hash, v.now.toISOString())
      .run();
    return 'created';
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message))) return 'duplicate';
    throw e;
  }
}
