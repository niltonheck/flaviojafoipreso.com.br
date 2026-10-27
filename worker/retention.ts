import { brasiliaDay } from './poll.ts';
import type { D1Like } from './types.ts';

/** A day's per-voter codes are deleted once the day ended at least 48 h ago (so 48-72 h with a daily job). */
export const RETENTION_DAYS_BEHIND = 3;

/** Last day (YYYY-MM-DD) whose votes may be purged at `now`: three Brasília calendar days back. */
export const purgeThroughDay = (now: Date) => brasiliaDay(new Date(now.getTime() - RETENTION_DAYS_BEHIND * 24 * 3600 * 1000));

/**
 * Rolls finished days up into anonymous daily totals and deletes the per-voter rows, in one transaction.
 * Safe to re-run: once a day is purged there is nothing left to roll up, and it never touches recent days
 * (the only days that can still receive votes), so a vote can never land on a purged day.
 */
export async function purgeOldVotes(db: D1Like, now: Date): Promise<{ throughDay: string; purgedVotes: number }> {
  const throughDay = purgeThroughDay(now);
  const pending = await db.prepare('SELECT COUNT(*) AS n FROM votes WHERE day <= ?').bind(throughDay).first<{ n: number }>();
  const purgedVotes = Number(pending?.n ?? 0);
  if (purgedVotes === 0) return { throughDay, purgedVotes };
  await db.batch([
    db.prepare(
      `INSERT INTO poll_day_totals (poll_id, day, yes, no)
       SELECT poll_id, day, SUM(choice = 'yes'), SUM(choice = 'no') FROM votes WHERE day <= ? GROUP BY poll_id, day
       ON CONFLICT (poll_id, day) DO UPDATE SET yes = yes + excluded.yes, no = no + excluded.no`,
    ).bind(throughDay),
    db.prepare('DELETE FROM votes WHERE day <= ?').bind(throughDay),
  ]);
  return { throughDay, purgedVotes };
}
