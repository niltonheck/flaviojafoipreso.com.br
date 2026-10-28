import type { D1Like } from './types.ts';

export type StatusRow = {
  status: 'yes' | 'no' | 'unverified';
  checked_at: string | null;
  verified_by: string;
  mode: 'auto' | 'manual';
  reason: string | null;
  evidence: string;
  updated_at: string;
};
export type NewsRow = { id: string; headline: string; published_at: string; publisher: string; url: string };

export const getStatus = (db: D1Like) =>
  db.prepare('SELECT status, checked_at, verified_by, mode, reason, evidence, updated_at FROM status_state WHERE id = 1').first<StatusRow>();

export async function setStatus(db: D1Like, s: Omit<StatusRow, 'updated_at'>, now: Date) {
  await db
    .prepare(
      `INSERT INTO status_state (id, status, checked_at, verified_by, mode, reason, evidence, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, verified_by = excluded.verified_by,
         mode = excluded.mode, reason = excluded.reason, evidence = excluded.evidence, updated_at = excluded.updated_at`,
    )
    .bind(s.status, s.checked_at, s.verified_by, s.mode, s.reason, s.evidence, now.toISOString())
    .run();
}

const idFor = async (url: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');

/** Inserts new headlines (url is unique, so re-runs are no-ops) and keeps only the newest `keep` rows. Returns how many were new. */
export async function addNews(db: D1Like, items: { headline: string; publishedAt: string; publisher: string; url: string }[], now: Date, keep = 60) {
  if (items.length === 0) return 0;
  const stmts = await Promise.all(
    items.map(async (n) =>
      db.prepare('INSERT OR IGNORE INTO news_items (id, headline, published_at, publisher, url, added_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(await idFor(n.url), n.headline, n.publishedAt, n.publisher, n.url, now.toISOString()),
    ),
  );
  const before = await db.prepare('SELECT COUNT(*) AS n FROM news_items').first<{ n: number }>();
  await db.batch([
    ...stmts,
    db.prepare('DELETE FROM news_items WHERE id NOT IN (SELECT id FROM news_items ORDER BY published_at DESC LIMIT ?)').bind(keep),
  ]);
  const after = await db.prepare('SELECT COUNT(*) AS n FROM news_items').first<{ n: number }>();
  return Math.max(0, Number(after?.n ?? 0) - Number(before?.n ?? 0));
}

export const latestNews = (db: D1Like, limit = 3) =>
  db.prepare('SELECT id, headline, published_at, publisher, url FROM news_items ORDER BY published_at DESC LIMIT ?').bind(limit).all<NewsRow>();

export const logRun = (db: D1Like, now: Date, outcome: string, summary: unknown) =>
  db.prepare('INSERT INTO editorial_runs (ran_at, outcome, summary) VALUES (?, ?, ?)').bind(now.toISOString(), outcome, JSON.stringify(summary)).run();
