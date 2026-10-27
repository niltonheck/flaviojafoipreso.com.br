import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../worker/api.ts';
import worker from '../worker/index.ts';
import { purgeOldVotes, purgeThroughDay } from '../worker/retention.ts';
import { POLL_ID, get, makeEnv } from './helpers/d1.ts';

type Raw = ReturnType<typeof makeEnv>['raw'];
let n = 0;
const addVotes = (raw: Raw, day: string, yes: number, no: number) => {
  const ins = raw.prepare('INSERT INTO votes (id, poll_id, day, choice, voter_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < yes + no; i++) ins.run(`v${n++}`, POLL_ID, day, i < yes ? 'yes' : 'no', `hash-${n}`, `${day}T15:00:00.000Z`);
};
const days = (raw: Raw) => (raw.prepare('SELECT day, COUNT(*) AS n FROM votes GROUP BY day ORDER BY day').all() as { day: string; n: number }[]).map((r) => `${r.day}:${r.n}`);
const totals = (raw: Raw) => raw.prepare('SELECT day, yes, no FROM poll_day_totals ORDER BY day').all();

describe('purgeThroughDay', () => {
  it('only reaches days that ended at least 48 hours ago', () => {
    // Day D ends at D+1 00:00 Brasília. At 2026-10-30 00:30 the 27th ended 48.5 h ago -> purgeable; the 28th did not.
    expect(purgeThroughDay(new Date('2026-10-30T03:30:00Z'))).toBe('2026-10-27');
    // One minute before midnight (23:59 on the 29th) the 27th ended 47.98 h ago... 27th is NOT yet purgeable.
    expect(purgeThroughDay(new Date('2026-10-30T02:59:00Z'))).toBe('2026-10-26');
  });
});

describe('purgeOldVotes', () => {
  const NOW = new Date('2026-10-30T08:00:00Z'); // 05:00 on the 30th in Brasília

  it('rolls old days into anonymous totals and deletes their per-voter rows, leaving recent days alone', async () => {
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-25', 3, 1);
    addVotes(raw, '2026-10-27', 2, 2);
    addVotes(raw, '2026-10-28', 5, 0); // too recent
    addVotes(raw, '2026-10-29', 1, 1); // too recent
    addVotes(raw, '2026-10-30', 1, 0); // today
    const r = await purgeOldVotes(env.DB, NOW);
    expect(r).toEqual({ throughDay: '2026-10-27', purgedVotes: 8 });
    expect(totals(raw)).toEqual([{ day: '2026-10-25', yes: 3, no: 1 }, { day: '2026-10-27', yes: 2, no: 2 }]);
    expect(days(raw)).toEqual(['2026-10-28:5', '2026-10-29:2', '2026-10-30:1']);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM votes WHERE day <= '2026-10-27'").get()).toEqual({ n: 0 });
  });

  it('is idempotent: running again never double-counts', async () => {
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-26', 4, 3);
    await purgeOldVotes(env.DB, NOW);
    const again = await purgeOldVotes(env.DB, NOW);
    expect(again.purgedVotes).toBe(0);
    expect(totals(raw)).toEqual([{ day: '2026-10-26', yes: 4, no: 3 }]);
  });

  it('keeps the final result of a closed poll exact (totals + not-yet-purged votes)', async () => {
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-26', 3, 1);
    addVotes(raw, '2026-10-29', 2, 2);
    await purgeOldVotes(env.DB, NOW); // 26th rolled up, 29th still live
    const api = createApi({ now: () => new Date('2027-10-29T12:00:00Z') }); // poll closed
    const res = (await api.handle(get(), env))!;
    expect(await res.json()).toMatchObject({ state: 'closed', day: null, yes: 5, no: 3, total: 8 });
  });

  it('is atomic: if the rollup fails, no votes are deleted', async () => {
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-26', 2, 0);
    raw.exec('DROP TABLE poll_day_totals');
    await expect(purgeOldVotes(env.DB, NOW)).rejects.toThrow();
    expect(days(raw)).toEqual(['2026-10-26:2']);
  });

  it('does nothing (and writes nothing) when there is nothing old enough', async () => {
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-30', 3, 0);
    expect((await purgeOldVotes(env.DB, NOW)).purgedVotes).toBe(0);
    expect(totals(raw)).toEqual([]);
  });

  it('keeps accumulating when a day is split across runs (upsert adds, never overwrites)', async () => {
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-26', 2, 1);
    await purgeOldVotes(env.DB, NOW);
    addVotes(raw, '2026-10-26', 1, 0); // a straggler row for an already-rolled-up day
    await purgeOldVotes(env.DB, NOW);
    expect(totals(raw)).toEqual([{ day: '2026-10-26', yes: 3, no: 1 }]);
  });
});

describe('scheduled handler', () => {
  it('purges via the cron entry point and logs counts only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T08:00:00Z'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { env, raw } = makeEnv();
    addVotes(raw, '2026-10-26', 2, 2);
    let pending: Promise<unknown> = Promise.resolve();
    await worker.scheduled({}, env, { waitUntil: (p) => { pending = p; } });
    await pending;
    expect(totals(raw)).toEqual([{ day: '2026-10-26', yes: 2, no: 2 }]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/hash-/);
    log.mockRestore();
    vi.useRealTimers();
  });
});
