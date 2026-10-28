import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, alertFor, assess, runEditorial, type Classify } from '../worker/editorial.ts';
import { ClassifierError } from '../worker/gemini.ts';
import { fetchFeeds } from '../worker/feeds.ts';
import { addNews, setStatus } from '../worker/siteState.ts';
import { FEEDS, G1_A, NORMAL, NOW, allFeeds, fakeFetch, rss } from './helpers/feeds.ts';
import { makeEnv } from './helpers/d1.ts';

type Env = ReturnType<typeof makeEnv>;
const NO: Classify = async () => ({ verdict: 'no', evidence: [] });
const PREV_CHECK = '2026-10-28T10:00:00.000Z';
const row = (raw: Env['raw']) => raw.prepare('SELECT * FROM status_state').get() as Record<string, string | null> | undefined;
const runs = (raw: Env['raw']) => raw.prepare('SELECT outcome FROM editorial_runs ORDER BY id').all().map((r) => (r as { outcome: string }).outcome);

type Opts = { routes?: Record<string, string | number | Error>; classify?: Classify | null; alert?: ReturnType<typeof vi.fn>; seed?: (e: Env) => Promise<void> };
async function go(opts: Opts = {}) {
  const e = makeEnv();
  await opts.seed?.(e);
  const alert = opts.alert ?? vi.fn(async () => {});
  const r = await runEditorial(e.env.DB, {
    now: () => NOW,
    fetchFn: fakeFetch(opts.routes ?? allFeeds(NORMAL)),
    feeds: FEEDS,
    classify: opts.classify === null ? undefined : (opts.classify ?? NO),
    alert,
  });
  return { ...e, r, alert };
}
/** A previous state: "no" (auto) last cleanly checked at PREV_CHECK, in the given condition. */
const seedNo = (reason: string | null = 'ok') => async (e: Env) =>
  setStatus(e.env.DB, { status: 'no', checked_at: PREV_CHECK, verified_by: 'auto-gemini', mode: 'auto', reason, evidence: '[]' }, NOW);
const seedYes = async (e: Env) =>
  setStatus(e.env.DB, { status: 'yes', checked_at: PREV_CHECK, verified_by: 'editor', mode: 'manual', reason: 'manual-hold', evidence: JSON.stringify([{ publisher: 'G1', title: 't', url: G1_A }]) }, NOW);

describe('a clean check', () => {
  it('renews the last-check time, labels it automatic, publishes verbatim headlines, and stays quiet', async () => {
    const { raw, r, alert } = await go();
    expect(r.outcome).toBe('renewed');
    expect(row(raw)).toMatchObject({ status: 'no', checked_at: NOW.toISOString(), verified_by: 'auto-gemini', mode: 'auto', reason: 'ok' });
    expect(raw.prepare('SELECT headline, publisher, url FROM news_items').all()).toEqual([{ headline: NORMAL[0].title, publisher: 'G1', url: G1_A }]);
    expect(alert).not.toHaveBeenCalled();
    expect(runs(raw)).toEqual(['renewed']);
  });

  it('does not duplicate headlines on later runs', async () => {
    const e = await go();
    const again = await runEditorial(e.env.DB, { now: () => NOW, fetchFn: fakeFetch(allFeeds(NORMAL)), feeds: FEEDS, classify: NO });
    expect(again.newNews).toBe(0);
    expect(e.raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 1 });
  });

  it('does not publish headlines that speculate about a future arrest, but still lets them inform the check', async () => {
    const classify = vi.fn(NO);
    const routes = allFeeds([...NORMAL, { title: 'Fuga do Brasil dá base para prisão preventiva de Flávio Bolsonaro, dizem especialistas', link: 'https://www1.folha.uol.com.br/poder/2026/10/spec.shtml', ageHours: 1 }]);
    const { raw } = await go({ routes, classify });
    expect(raw.prepare('SELECT headline FROM news_items').all()).toEqual([{ headline: NORMAL[0].title }]);
    expect((classify.mock.calls[0][0] as { title: string }[]).some((i) => /preventiva/.test(i.title))).toBe(true);
  });

  it('emails when the check recovers from a problem', async () => {
    const { alert } = await go({ seed: seedNo('feeds-unhealthy') });
    expect(alert).toHaveBeenCalledOnce();
    expect(String(alert.mock.calls[0][0])).toContain('normalizada');
  });
});

describe('the answer never changes: a problem only keeps the old check time and tells you', () => {
  const stays = (raw: Env['raw'], reason: RegExp | string, checkedAt: string | null = PREV_CHECK) => {
    const s = row(raw)!;
    expect(s.status).toBe('no'); // never "yes", and no third state exists
    expect(s.checked_at).toBe(checkedAt); // not renewed: the last clean check time is kept
    expect(s.reason).toMatch(reason);
  };

  it('keyword tripwire: no AI call, one alert with the headline and the exact command to confirm a SIM', async () => {
    const classify = vi.fn(NO);
    const routes = allFeeds([{ title: 'Flávio Bolsonaro é preso pela PF', link: G1_A }, ...NORMAL]);
    const { raw, alert } = await go({ routes, classify, seed: seedNo() });
    stays(raw, 'arrest-signal-keyword');
    expect(classify).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledOnce();
    const [subject, body] = alert.mock.calls[0] as unknown as [string, string];
    expect(subject).toContain('Possível sinal de prisão');
    expect(body).toContain('Flávio Bolsonaro é preso pela PF');
    expect(body).toContain('continua mostrando "NÃO."');
    expect(body).toContain('site:hold -- yes');
    expect(runs(raw)).toEqual(['attention:arrest-signal-keyword']);
  });

  it('AI says "yes": still NÃO (a human decides), with the verified quote in the email', async () => {
    const { raw, alert } = await go({ classify: async () => ({ verdict: 'yes', evidence: [{ url: G1_A, quote: 'Flávio Bolsonaro não entrega passaporte' }] }), seed: seedNo() });
    stays(raw, 'arrest-signal-ai');
    expect(String(alert.mock.calls[0][1])).toContain('Flávio Bolsonaro não entrega passaporte');
  });

  it('AI uncertain: still NÃO, but you are told', async () => {
    const { raw, alert } = await go({ classify: async () => ({ verdict: 'uncertain', evidence: [] }), seed: seedNo() });
    stays(raw, 'ai-uncertain');
    expect(String(alert.mock.calls[0][0])).toContain('Possível sinal de prisão');
  });

  it('AI errors or lies: the check could not run, so you are told (a different email)', async () => {
    const lie = await go({ classify: async () => { throw new ClassifierError('unverifiable-evidence'); }, seed: seedNo() });
    stays(lie.raw, 'classifier-error:unverifiable-evidence');
    expect(String(lie.alert.mock.calls[0][0])).toContain('não conseguiu verificar');
    const boom = await go({ classify: async () => { throw new Error('boom'); }, seed: seedNo() });
    stays(boom.raw, 'classifier-error:unexpected');
  });

  it('no API key: cannot verify', async () => stays((await go({ classify: null, seed: seedNo() })).raw, 'classifier-unavailable'));

  it('feeds blocked/down: cannot verify, news left alone', async () => {
    const routes = Object.fromEntries(FEEDS.map((f) => [f.url, 403]));
    const { raw, alert } = await go({ routes, seed: seedNo() });
    stays(raw, 'feeds-unhealthy');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 0 });
    expect(alert).toHaveBeenCalledOnce();
  });

  it('too few live feeds, or one outlet only', async () => {
    const two = { [FEEDS[0].url]: rss(NORMAL), [FEEDS[1].url]: rss(NORMAL), [FEEDS[2].url]: 500, [FEEDS[3].url]: 500 };
    stays((await go({ routes: two, seed: seedNo() })).raw, 'feeds-unhealthy');
  });

  it('a feed that stopped updating does not count as live', async () => {
    const routes = Object.fromEntries(FEEDS.map((f) => [f.url, rss(NORMAL, 72)]));
    stays((await go({ routes, seed: seedNo() })).raw, 'feeds-unhealthy');
  });

  it('no recent coverage (or only old headlines): nothing to verify against', async () => {
    stays((await go({ routes: allFeeds([{ title: 'Dólar fecha em alta', link: 'https://g1.globo.com/e.ghtml' }]), seed: seedNo() })).raw, 'no-recent-coverage');
    stays((await go({ routes: allFeeds([{ ...NORMAL[0], ageHours: 100 }]), seed: seedNo() })).raw, 'no-recent-coverage');
  });

  it('on the very first run a problem still yields "no" with no check time', async () => {
    const { raw } = await go({ classify: null });
    stays(raw, 'classifier-unavailable', null);
  });

  it('NO REPEAT SPAM: the same condition as last time sends no email', async () => {
    const { alert, raw } = await go({ routes: Object.fromEntries(FEEDS.map((f) => [f.url, 500])), seed: seedNo('feeds-unhealthy') });
    expect(alert).not.toHaveBeenCalled();
    expect(row(raw)!.reason).toBe('feeds-unhealthy');
  });

  it('a change from one problem to another does email', async () => {
    const routes = allFeeds([{ title: 'Flávio Bolsonaro é preso pela PF', link: G1_A }, ...NORMAL]);
    const { alert } = await go({ routes, seed: seedNo('feeds-unhealthy') });
    expect(alert).toHaveBeenCalledOnce();
  });

  it('assess() only ever yields ok / arrest-signal / cannot-verify, and a "yes" verdict never becomes an answer', async () => {
    const live = (n: number) => FEEDS.slice(0, n).map((f) => ({ feed: f.id, publisher: f.publisher, ok: true, newest: NOW.toISOString(), items: [] }));
    const item = { feed: 'g1', publisher: 'G1', title: 'Flávio Bolsonaro x', url: G1_A, publishedAt: NOW.toISOString(), description: '' };
    const kinds = new Set<string>();
    for (const n of [0, 2, 4]) for (const rel of [[], [item]]) for (const c of [undefined, async () => ({ verdict: 'yes' as const, evidence: [] }), NO, async () => { throw new Error('x'); }]) {
      kinds.add((await assess({ results: live(n), relevant: rel, now: NOW, cfg: DEFAULT_CONFIG, classify: c as Classify | undefined })).kind);
    }
    expect([...kinds].sort()).toEqual(['arrest-signal', 'cannot-verify', 'ok']);
    const { raw } = await go({ classify: async () => ({ verdict: 'yes', evidence: [{ url: G1_A, quote: 'Flávio Bolsonaro não entrega passaporte' }] }) });
    expect(row(raw)!.status).toBe('no');
  });
});

describe('a human-recorded SIM is never touched', () => {
  it('stays SIM (with its sources) whatever the check finds, but news keeps flowing and nothing is emailed', async () => {
    const { raw, r, alert } = await go({ seed: seedYes, classify: async () => ({ verdict: 'no', evidence: [] }) });
    expect(r.outcome).toBe('yes-held');
    expect(row(raw)).toMatchObject({ status: 'yes', mode: 'manual', verified_by: 'editor' });
    expect(JSON.parse(String(row(raw)!.evidence))).toHaveLength(1);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 1 });
    expect(alert).not.toHaveBeenCalled();
    expect(runs(raw)).toEqual(['yes-held']);
  });
});

describe('alertFor', () => {
  it('is silent when the condition did not change, including "ok" -> "ok" and first-run "ok"', () => {
    expect(alertFor('ok', 'ok', [])).toBeNull();
    expect(alertFor(null, 'ok', [])).toBeNull();
    expect(alertFor('feeds-unhealthy', 'feeds-unhealthy', [])).toBeNull();
  });
  it('tells arrest signals, failures and recovery apart', () => {
    expect(alertFor('ok', 'arrest-signal-ai', [])!.subject).toContain('Possível sinal de prisão');
    expect(alertFor('ok', 'ai-uncertain', [])!.subject).toContain('Possível sinal de prisão');
    expect(alertFor('ok', 'feeds-unhealthy', [])!.subject).toContain('não conseguiu verificar');
    expect(alertFor('feeds-unhealthy', 'ok', [])!.subject).toContain('normalizada');
    expect(alertFor(null, 'classifier-unavailable', [])).not.toBeNull(); // first run with a problem is worth an email
  });
  it('never promises a SIM', () => expect(alertFor('ok', 'arrest-signal-keyword', [{ url: 'https://g1.globo.com/a', quote: 'x' }])!.body).toContain('nunca define "SIM"'));
});

describe('robustness', () => {
  it('an email failure never breaks the run or the stored state', async () => {
    const alert = vi.fn(async () => { throw new Error('smtp down'); });
    const { raw } = await go({ routes: allFeeds([{ title: 'Flávio Bolsonaro é preso', link: G1_A }]), alert, seed: seedNo() });
    expect(row(raw)).toMatchObject({ status: 'no', reason: 'arrest-signal-keyword' });
  });

  it('keeps only the newest headlines when pruning', async () => {
    const { env, raw } = makeEnv();
    const mk = (n: number) => ({ headline: `h${n}`, publishedAt: new Date(NOW.getTime() - n * 3_600_000).toISOString(), publisher: 'G1', url: `https://g1.globo.com/${n}.ghtml` });
    await addNews(env.DB, [mk(1), mk(2), mk(3), mk(4)], NOW, 2);
    expect(raw.prepare('SELECT headline FROM news_items ORDER BY published_at DESC').all()).toEqual([{ headline: 'h1' }, { headline: 'h2' }]);
  });

  it('survives a feed returning an absurdly large body', async () => {
    const big = `<rss><channel>${'<item><title>x</title><link>https://g1.globo.com/a</link></item>'.repeat(5000)}</channel></rss>`;
    const r = await fetchFeeds([FEEDS[0]], fakeFetch({ [FEEDS[0].url]: big }));
    expect(r[0].items.length).toBeLessThanOrEqual(200);
  });
});
