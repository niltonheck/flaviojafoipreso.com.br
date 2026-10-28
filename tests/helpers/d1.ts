import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { D1Like, D1Statement, Env } from '../../worker/types.ts';

/** D1-shaped wrapper over node:sqlite so tests exercise real SQLite constraint semantics. */
export function makeD1(db: DatabaseSync): D1Like {
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...v) => stmt(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  const batch = async (stmts: D1Statement[]) => {
    db.exec('BEGIN');
    try { const out = []; for (const st of stmts) out.push(await st.run()); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return { prepare: (sql) => stmt(sql), batch };
}

export const SECRET = 'test-secret-test-secret-test-secret-0123456789';
export const POLL_ID = 'staging-arrest-today';

export function makeEnv(over: Partial<Env> = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'));
  raw.exec(readFileSync(new URL('../../migrations/0002_day_totals.sql', import.meta.url), 'utf8'));
  raw.exec(readFileSync(new URL('../../migrations/0003_editorial.sql', import.meta.url), 'utf8'));
  raw.exec(readFileSync(new URL('../../seeds/staging.sql', import.meta.url), 'utf8'));
  const env: Env = { DB: makeD1(raw), ASSETS: { fetch: async () => new Response('asset') }, VOTER_HMAC_SECRET: SECRET, ...over };
  return { env, raw };
}

export const ORIGIN = 'https://example.test';

export function get(path = '/api/polls/current', init: RequestInit = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

export function post(choice: unknown, cookie?: string, over: { headers?: Record<string, string>; body?: string; path?: string } = {}) {
  return new Request(`${ORIGIN}${over.path ?? `/api/polls/${POLL_ID}/votes`}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...over.headers },
    body: over.body ?? JSON.stringify({ choice }),
  });
}

/** Extract the `name=value` pair from a Set-Cookie header, as a browser would send it back. */
export const cookieFrom = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
