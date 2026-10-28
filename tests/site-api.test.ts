import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../worker/api.ts';
import { addNews, setStatus } from '../worker/siteState.ts';
import { get, makeEnv } from './helpers/d1.ts';

const NOW = new Date('2026-10-28T15:00:00Z');
const seed = async (e: ReturnType<typeof makeEnv>, status: 'yes' | 'no' | 'unverified' = 'no', evidence = '[]') => {
  await setStatus(e.env.DB, { status, checked_at: status === 'unverified' ? null : '2026-10-28T14:00:00.000Z', verified_by: 'auto-gemini', mode: 'auto', reason: 'ok', evidence }, NOW);
  await addNews(e.env.DB, [1, 2, 3, 4].map((n) => ({ headline: `h${n}`, publishedAt: new Date(NOW.getTime() - n * 3_600_000).toISOString(), publisher: 'G1', url: `https://g1.globo.com/${n}.ghtml` })), NOW);
};
const call = async (env: ReturnType<typeof makeEnv>['env']) => (await (await createApi({ now: () => NOW }).handle(get(), env))!.json()) as Record<string, any>;

describe('GET /api/polls/current: site', () => {
  it('is absent unless AUTOMATION_ENABLED is exactly "true" (the kill switch also hides stored state)', async () => {
    for (const flag of [undefined, 'false', '1']) {
      const e = makeEnv({ AUTOMATION_ENABLED: flag }); await seed(e);
      expect('site' in (await call(e.env))).toBe(false);
    }
  });

  it('is absent until the job has stored a status', async () => {
    const e = makeEnv({ AUTOMATION_ENABLED: 'true' });
    expect('site' in (await call(e.env))).toBe(false);
  });

  it('carries the automated status and the 3 newest headlines, and nothing internal', async () => {
    const e = makeEnv({ AUTOMATION_ENABLED: 'true' }); await seed(e);
    const body = await call(e.env);
    expect(body.site.status).toEqual({ status: 'no', checkedAt: '2026-10-28T14:00:00.000Z', verifiedBy: 'auto-gemini', mode: 'auto', evidence: [] });
    expect(body.site.news.map((n: { headline: string }) => n.headline)).toEqual(['h1', 'h2', 'h3']);
    expect(JSON.stringify(body.site)).not.toMatch(/reason|updated_at|added_at|"id"/);
    expect(body.yes).toBe(0); // the poll payload is untouched
  });

  it('passes through manual "yes" evidence', async () => {
    const e = makeEnv({ AUTOMATION_ENABLED: 'true' });
    await seed(e, 'yes', JSON.stringify([{ publisher: 'G1', title: 't', url: 'https://g1.globo.com/x.ghtml' }]));
    expect((await call(e.env)).site.status.evidence).toEqual([{ publisher: 'G1', title: 't', url: 'https://g1.globo.com/x.ghtml' }]);
  });

  it('a failure reading the automated state never breaks the poll', async () => {
    const e = makeEnv({ AUTOMATION_ENABLED: 'true' }); await seed(e);
    const real = e.env.DB.prepare.bind(e.env.DB);
    e.env.DB.prepare = (sql: string) => { if (sql.includes('status_state')) throw new Error('boom'); return real(sql); };
    const body = await call(e.env);
    expect(body.state).toBe('open');
    expect('site' in body).toBe(false);
  });

  it('survives corrupt evidence JSON', async () => {
    const e = makeEnv({ AUTOMATION_ENABLED: 'true' }); await seed(e, 'no', '{not json');
    expect((await call(e.env)).site.status.evidence).toEqual([]);
  });
});
