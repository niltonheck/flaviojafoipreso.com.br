import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, decide, runEditorial, type Classify } from '../worker/editorial.ts';
import { ClassifierError } from '../worker/gemini.ts';
import { fetchFeeds } from '../worker/feeds.ts';
import { addNews, setStatus } from '../worker/siteState.ts';
import { FEEDS, G1_A, NORMAL, NOW, allFeeds, fakeFetch, rss } from './helpers/feeds.ts';
import { makeEnv } from './helpers/d1.ts';

const NO: Classify = async () => ({ verdict: 'no', evidence: [] });
const row = (raw: ReturnType<typeof makeEnv>['raw']) => raw.prepare('SELECT * FROM status_state').get() as Record<string, string | null> | undefined;
const runs = (raw: ReturnType<typeof makeEnv>['raw']) => raw.prepare('SELECT outcome FROM editorial_runs ORDER BY id').all().map((r) => (r as { outcome: string }).outcome);

async function go(opts: { routes?: Record<string, never> | Record<string, string | number | Error>; classify?: Classify | null; alert?: ReturnType<typeof vi.fn>; seed?: (e: ReturnType<typeof makeEnv>) => Promise<void> } = {}) {
  const e = makeEnv();
  await opts.seed?.(e);
  const alert = opts.alert ?? vi.fn(async () => {});
  const r = await runEditorial(e.env.DB, {
    now: () => NOW,
    fetchFn: fakeFetch((opts.routes as never) ?? allFeeds(NORMAL)),
    feeds: FEEDS,
    classify: opts.classify === null ? undefined : (opts.classify ?? NO),
    alert,
  });
  return { ...e, r, alert };
}
const seedStatus = (status: 'yes' | 'no' | 'unverified', mode: 'auto' | 'manual') => async (e: ReturnType<typeof makeEnv>) =>
  setStatus(e.env.DB, { status, checked_at: status === 'unverified' ? null : '2026-10-28T10:00:00.000Z', verified_by: mode === 'manual' ? 'editor' : 'auto-gemini', mode, reason: null, evidence: '[]' }, NOW);

describe('happy path', () => {
  it('renews "no" with a fresh timestamp, labels it automatic, publishes verbatim headlines, and stays quiet', async () => {
    const { raw, r, alert } = await go();
    expect(r.outcome).toBe('renewed');
    expect(row(raw)).toMatchObject({ status: 'no', checked_at: NOW.toISOString(), verified_by: 'auto-gemini', mode: 'auto', reason: 'ok' });
    const news = raw.prepare('SELECT headline, publisher, url FROM news_items').all();
    expect(news).toEqual([{ headline: NORMAL[0].title, publisher: 'G1', url: G1_A }]); // verbatim, one copy despite 4 feeds
    expect(alert).not.toHaveBeenCalled(); // first run, nothing changed
    expect(runs(raw)).toEqual(['renewed']);
  });

  it('does not duplicate headlines on later runs', async () => {
    const e = await go();
    const again = await runEditorial(e.env.DB, { now: () => NOW, fetchFn: fakeFetch(allFeeds(NORMAL)), feeds: FEEDS, classify: NO });
    expect(again.newNews).toBe(0);
    expect(e.raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 1 });
  });

  it('emails when the site recovers from NÃO VERIFICADO', async () => {
    const { alert } = await go({ seed: seedStatus('unverified', 'auto') });
    expect(alert).toHaveBeenCalledOnce();
    expect(String(alert.mock.calls[0][0])).toContain('voltou a NÃO');
  });
});

describe('fail closed: every doubt becomes NÃO VERIFICADO (and never SIM)', () => {
  const expectUnverified = (raw: ReturnType<typeof makeEnv>['raw'], reason: RegExp | string) => {
    const s = row(raw)!;
    expect(s.status).toBe('unverified');
    expect(s.checked_at).toBeNull();
    expect(s.reason).toMatch(reason);
  };

  it('keyword tripwire fires without ever calling the AI, and alerts with the headline', async () => {
    const classify = vi.fn(NO);
    const routes = allFeeds([{ title: 'Flávio Bolsonaro é preso pela PF', link: G1_A }, ...NORMAL]);
    const { raw, alert } = await go({ routes, classify, seed: seedStatus('no', 'auto') });
    expectUnverified(raw, 'arrest-signal-keyword');
    expect(classify).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledOnce();
    expect(String(alert.mock.calls[0][1])).toContain('Flávio Bolsonaro é preso pela PF');
    expect(String(alert.mock.calls[0][1])).toContain('nunca define "SIM"');
  });

  it('AI says "yes" -> unverified, NOT yes', async () => {
    const { raw, alert } = await go({ classify: async () => ({ verdict: 'yes', evidence: [{ url: G1_A, quote: 'Flávio Bolsonaro não entrega passaporte' }] }), seed: seedStatus('no', 'auto') });
    expectUnverified(raw, 'arrest-signal-ai');
    expect(alert).toHaveBeenCalledOnce();
  });

  it('AI uncertain -> unverified', async () => {
    const { raw } = await go({ classify: async () => ({ verdict: 'uncertain', evidence: [] }), seed: seedStatus('no', 'auto') });
    expectUnverified(raw, 'ai-uncertain');
  });

  it('AI errors or lies -> unverified', async () => {
    const { raw } = await go({ classify: async () => { throw new ClassifierError('unverifiable-evidence'); }, seed: seedStatus('no', 'auto') });
    expectUnverified(raw, 'classifier-error:unverifiable-evidence');
    const b = await go({ classify: async () => { throw new Error('boom'); } });
    expectUnverified(b.raw, 'classifier-error:unexpected');
  });

  it('no API key configured -> unverified', async () => {
    const { raw } = await go({ classify: null });
    expectUnverified(raw, 'classifier-unavailable');
  });

  it('feeds blocked/down -> unverified, and the news list is left alone', async () => {
    const routes = Object.fromEntries(FEEDS.map((f) => [f.url, 403]));
    const { raw, alert } = await go({ routes, seed: seedStatus('no', 'auto') });
    expectUnverified(raw, 'feeds-unhealthy');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 0 });
    expect(alert).toHaveBeenCalledOnce();
  });

  it('too few live feeds, or only one outlet, -> unverified', async () => {
    const two = { [FEEDS[0].url]: rss(NORMAL), [FEEDS[1].url]: rss(NORMAL), [FEEDS[2].url]: 500, [FEEDS[3].url]: 500 }; // 2 feeds, 1 outlet
    expectUnverified((await go({ routes: two })).raw, 'feeds-unhealthy');
  });

  it('a feed that stopped updating does not count as live', async () => {
    const routes = Object.fromEntries(FEEDS.map((f) => [f.url, rss(NORMAL, 72)])); // newest item 72 h old
    expectUnverified((await go({ routes })).raw, 'feeds-unhealthy');
  });

  it('no recent coverage of him -> unverified (nothing to verify against)', async () => {
    expectUnverified((await go({ routes: allFeeds([{ title: 'Dólar fecha em alta', link: 'https://g1.globo.com/e.ghtml' }]) })).raw, 'no-recent-coverage');
  });

  it('old headlines outside the window do not count as current coverage', async () => {
    const routes = allFeeds([{ ...NORMAL[0], ageHours: 100 }]);
    expectUnverified((await go({ routes })).raw, 'no-recent-coverage');
  });

  it('decide() can only ever return "no" or "unverified", across every input combination', async () => {
    const results = (n: number) => FEEDS.slice(0, n).map((f) => ({ feed: f.id, publisher: f.publisher, ok: true, newest: NOW.toISOString(), items: [] }));
    const item = { feed: 'g1', publisher: 'G1', title: 'Flávio Bolsonaro x', url: G1_A, publishedAt: NOW.toISOString(), description: '' };
    const seen = new Set<string>();
    for (const n of [0, 2, 4]) for (const rel of [[], [item]]) for (const c of [undefined, async () => ({ verdict: 'yes' as const, evidence: [] }), async () => ({ verdict: 'no' as const, evidence: [] }), async () => { throw new Error('x'); }]) {
      seen.add((await decide({ results: results(n), relevant: rel, now: NOW, cfg: DEFAULT_CONFIG, classify: c as Classify | undefined })).status);
    }
    expect([...seen].sort()).toEqual(['no', 'unverified']);
  });
});

describe('a human always wins', () => {
  it('never touches a manually set status (even "yes"), but still publishes news', async () => {
    const { raw, r, alert } = await go({ seed: seedStatus('yes', 'manual'), classify: async () => ({ verdict: 'no', evidence: [] }) });
    expect(r.outcome).toBe('manual-hold');
    expect(row(raw)).toMatchObject({ status: 'yes', mode: 'manual', verified_by: 'editor' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 1 });
    expect(alert).not.toHaveBeenCalled();
    expect(runs(raw)).toEqual(['manual-hold']);
  });

  it('a manual "unverified" is also left alone', async () => {
    const { raw } = await go({ seed: seedStatus('unverified', 'manual') });
    expect(row(raw)).toMatchObject({ status: 'unverified', mode: 'manual' });
  });
});

describe('robustness', () => {
  it('an email failure never breaks the run or rolls back the status', async () => {
    const alert = vi.fn(async () => { throw new Error('smtp down'); });
    const { raw } = await go({ routes: allFeeds([{ title: 'Flávio Bolsonaro é preso', link: G1_A }]), alert, seed: seedStatus('no', 'auto') });
    expect(row(raw)!.status).toBe('unverified');
  });

  it('keeps only the newest headlines when pruning', async () => {
    const { env, raw } = makeEnv();
    const mk = (n: number) => ({ headline: `h${n}`, publishedAt: new Date(NOW.getTime() - n * 3_600_000).toISOString(), publisher: 'G1', url: `https://g1.globo.com/${n}.ghtml` });
    await addNews(env.DB, [mk(1), mk(2), mk(3), mk(4)], NOW, 2);
    expect(raw.prepare('SELECT headline FROM news_items ORDER BY published_at DESC').all()).toEqual([{ headline: 'h1' }, { headline: 'h2' }]);
  });

  it('fetchFeeds + parse survive a feed returning an absurdly large body', async () => {
    const big = `<rss><channel>${'<item><title>x</title><link>https://g1.globo.com/a</link></item>'.repeat(5000)}</channel></rss>`;
    const r = await fetchFeeds([FEEDS[0]], fakeFetch({ [FEEDS[0].url]: big }));
    expect(r[0].items.length).toBeLessThanOrEqual(200);
  });
});
