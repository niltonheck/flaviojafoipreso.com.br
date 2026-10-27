import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../worker/api.ts';
import { ORIGIN, POLL_ID, SECRET, cookieFrom, get, makeEnv, post } from './helpers/d1.ts';

const T0 = new Date('2026-10-27T15:00:00Z'); // 12:00 in Brasília
const clock = (d: Date) => { let t = d; return { now: () => t, set: (n: Date) => { t = n; } }; };

async function setup(opts: { at?: Date; env?: Parameters<typeof makeEnv>[0] } = {}) {
  const c = clock(opts.at ?? T0);
  const { env, raw } = makeEnv(opts.env);
  const api = createApi({ now: c.now });
  const call = async (r: Request) => (await api.handle(r, env))!;
  const visit = async () => { const res = await call(get()); return { res, cookie: cookieFrom(res) }; };
  return { api, env, raw, c, call, visit };
}

describe('GET /api/polls/current', () => {
  it('returns the poll with zero fabricated counts and issues a hardened cookie', async () => {
    const { visit } = await setup();
    const { res } = await visit();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const set = res.headers.get('set-cookie')!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Path=\/api/);
    expect(set).toMatch(/Secure/); // https origin
    const body = await res.json();
    expect(body).toMatchObject({ id: POLL_ID, state: 'open', day: '2026-10-27', yes: 0, no: 0, total: 0, viewerHasVoted: false, viewerChoice: null });
  });

  it('does not issue a new cookie when a valid one is presented, and rejects tampered cookies', async () => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    expect((await call(get('/api/polls/current', { headers: { cookie } }))).headers.get('set-cookie')).toBeNull();
    const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await call(get('/api/polls/current', { headers: { cookie: forged } }))).headers.get('set-cookie')).not.toBeNull();
  });

  it('omits Secure on plain http (local dev)', async () => {
    const { api, env } = await setup();
    const res = (await api.handle(new Request('http://localhost:8787/api/polls/current'), env))!;
    expect(res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });
});

describe('POST /api/polls/:id/votes', () => {
  it('records a vote (201) and reflects it for that viewer only', async () => {
    const { call, visit } = await setup();
    const a = await visit();
    const res = await call(post('yes', a.cookie));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({ yes: 1, no: 0, total: 1, viewerHasVoted: true, viewerChoice: 'yes' });
    // another visitor sees the count but not A's vote state (no cross-user leak)
    const b = await visit();
    expect(await (await call(get('/api/polls/current', { headers: { cookie: b.cookie } }))).json()).toMatchObject({ yes: 1, total: 1, viewerHasVoted: false, viewerChoice: null });
    expect(await (await call(get('/api/polls/current', { headers: { cookie: a.cookie } }))).json()).toMatchObject({ viewerHasVoted: true, viewerChoice: 'yes' });
  });

  it('rejects a second vote the same day (409) and does not change counts', async () => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    expect((await call(post('yes', cookie))).status).toBe(201);
    const again = await call(post('no', cookie));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_voted' });
    expect(await (await call(get('/api/polls/current', { headers: { cookie } }))).json()).toMatchObject({ yes: 1, no: 0 });
  });

  it('allows the same voter to vote again the next Brasília day', async () => {
    const { call, visit, c } = await setup();
    const { cookie } = await visit();
    expect((await call(post('yes', cookie))).status).toBe(201);
    c.set(new Date('2026-10-28T15:00:00Z'));
    const next = await call(post('no', cookie));
    expect(next.status).toBe(201);
    expect(await next.json()).toMatchObject({ day: '2026-10-28', yes: 0, no: 1, total: 1 });
  });

  it('uses the Brasília day boundary, not UTC', async () => {
    const { call, visit, c } = await setup({ at: new Date('2026-10-28T02:30:00Z') }); // 23:30 on the 27th in Brasília
    const { cookie } = await visit();
    expect((await call(post('yes', cookie))).status).toBe(201);
    c.set(new Date('2026-10-28T03:30:00Z')); // 00:30 on the 28th
    expect((await call(post('yes', cookie))).status).toBe(201);
  });

  it('is atomic under concurrent duplicate votes: exactly one wins', async () => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    const statuses = (await Promise.all(Array.from({ length: 25 }, () => call(post('yes', cookie))))).map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(24);
    expect(await (await call(get('/api/polls/current', { headers: { cookie } }))).json()).toMatchObject({ total: 1 });
  });

  it('counts concurrent votes from different voters correctly', async () => {
    const { call, visit } = await setup();
    const voters = await Promise.all(Array.from({ length: 30 }, () => visit()));
    await Promise.all(voters.map((v, i) => call(post(i % 3 === 0 ? 'no' : 'yes', v.cookie))));
    const body = await (await call(get())).json();
    expect(body).toMatchObject({ yes: 20, no: 10, total: 30 });
  });

  it('refuses votes after the poll closes (403) and shows the whole-poll tally', async () => {
    const { call, visit, c } = await setup();
    const { cookie } = await visit();
    expect((await call(post('yes', cookie))).status).toBe(201);
    c.set(new Date('2027-10-29T12:00:00Z'));
    const res = await call(post('no', cookie));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'poll_closed' });
    expect(await (await call(get('/api/polls/current', { headers: { cookie } }))).json()).toMatchObject({ state: 'closed', day: null, yes: 1 });
  });

  it('refuses votes before the poll starts', async () => {
    const { call, visit } = await setup({ at: new Date('2025-01-01T12:00:00Z') });
    const { cookie } = await visit();
    expect((await call(post('yes', cookie))).status).toBe(403);
  });

  it('404s for an unknown poll id', async () => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    expect((await call(post('yes', cookie, { path: '/api/polls/nope/votes' }))).status).toBe(404);
  });

  it('stores only an HMAC of the voter id, never the raw identifier', async () => {
    const { call, visit, raw } = await setup();
    const { cookie } = await visit();
    await call(post('yes', cookie));
    const id = cookie.split('=')[1].split('.')[0];
    const row = raw.prepare('SELECT * FROM votes').get() as { voter_hash: string };
    expect(row.voter_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(raw.prepare('SELECT * FROM votes').all())).not.toContain(id);
    expect(JSON.stringify(raw.prepare('SELECT * FROM votes').all())).not.toContain(SECRET);
  });
});

describe('input validation', () => {
  it.each([
    ['bad choice', post('maybe')],
    ['numeric choice', post(1)],
    ['missing choice', post(undefined, undefined, { body: '{}' })],
    ['extra keys', post('yes', undefined, { body: '{"choice":"yes","x":1}' })],
    ['array body', post('yes', undefined, { body: '["yes"]' })],
    ['malformed JSON', post('yes', undefined, { body: '{nope' })],
  ])('rejects %s with 400', async (_n, req) => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    const r = new Request(req, { headers: new Headers({ ...Object.fromEntries(req.headers), cookie }) });
    expect((await call(r)).status).toBe(400);
  });

  it('rejects non-JSON content types (415) and oversized bodies (413)', async () => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    expect((await call(post('yes', cookie, { headers: { 'content-type': 'text/plain' } }))).status).toBe(415);
    expect((await call(post('yes', cookie, { body: JSON.stringify({ choice: 'yes', pad: 'x'.repeat(2000) }) }))).status).toBe(413);
  });

  it('rejects a missing, forged or foreign-signature cookie (400 invalid_voter)', async () => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    expect(await (await call(post('yes'))).json()).toEqual({ error: 'invalid_voter' });
    expect((await call(post('yes', 'fjfp_vid=abc.def'))).status).toBe(400);
    const otherSecret = createApi({ now: () => T0 });
    const { env: env2 } = makeEnv({ VOTER_HMAC_SECRET: 'another-secret-another-secret-another-secret-9999' });
    const foreign = cookieFrom((await otherSecret.handle(get(), env2))!);
    expect((await call(post('yes', foreign))).status).toBe(400);
    expect((await call(post('yes', cookie))).status).toBe(201);
  });

  it('handles unknown routes and wrong methods', async () => {
    const { api, env, call } = await setup();
    expect((await call(get('/api/unknown'))).status).toBe(404);
    expect((await call(new Request(`${ORIGIN}/api/polls/current`, { method: 'DELETE' }))).status).toBe(405);
    expect((await call(new Request(`${ORIGIN}/api/polls/${POLL_ID}/votes`))).status).toBe(405);
    expect(await api.handle(get('/index.html'), env)).toBeNull(); // static assets are not the API's business
  });
});

describe('cross-site protection', () => {
  it.each([
    ['no Origin header', { origin: '' }],
    ['foreign Origin', { origin: 'https://evil.test' }],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
  ])('rejects a vote with %s (403)', async (_n, headers) => {
    const { call, visit } = await setup();
    const { cookie } = await visit();
    const req = post('yes', cookie, { headers });
    if (headers.origin === '') req.headers.delete('origin');
    expect((await call(req)).status).toBe(403);
    expect(await (await call(get())).json()).toMatchObject({ total: 0 });
  });

  it('accepts additional origins listed in ALLOWED_ORIGINS (e.g. www, local dev)', async () => {
    const { call, visit } = await setup({ env: { ALLOWED_ORIGINS: 'https://www.example.test, http://localhost:4321' } });
    const { cookie } = await visit();
    expect((await call(post('yes', cookie, { headers: { origin: 'http://localhost:4321' } }))).status).toBe(201);
  });

  it('sets no CORS headers (same-origin only)', async () => {
    const { visit } = await setup();
    expect((await visit()).res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After when the limiter says no', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const { call, visit } = await setup({ env: { VOTE_LIMITER: { limit } } });
    const { cookie } = await visit();
    const res = await call(post('yes', cookie));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await (await call(get())).json()).toMatchObject({ total: 0 });
  });

  it('keys the limiter on hashes, never raw IPs or cookies', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const { call, visit } = await setup({ env: { VOTE_LIMITER: { limit } } });
    const { cookie } = await visit();
    await call(post('yes', cookie, { headers: { 'cf-connecting-ip': '203.0.113.9' } }));
    const keys = limit.mock.calls.map((c) => c[0].key as string);
    expect(keys).toHaveLength(2);
    for (const k of keys) { expect(k).not.toContain('203.0.113.9'); expect(k).not.toContain(cookie.split('=')[1]); }
  });
});

describe('failure modes', () => {
  it.each([['missing', undefined], ['too short', 'short']])('fails closed with 503 when the secret is %s', async (_n, secret) => {
    const { call } = await setup({ env: { VOTER_HMAC_SECRET: secret } });
    const res = await call(get());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('returns a generic 503 (no internals) when D1 fails, on GET and on vote', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { prepare: () => { throw new Error('D1_ERROR: secret internals'); } };
    const { api, env: good } = await setup();
    const env = { ...good, DB: broken as never };
    const g = (await api.handle(get(), env))!;
    expect(g.status).toBe(503);
    expect(await g.text()).not.toMatch(/internals|D1_ERROR/);
    const { cookie } = { cookie: cookieFrom((await api.handle(get(), good))!) };
    const p = (await api.handle(post('yes', cookie), env))!;
    expect(p.status).toBe(503);
    expect(await p.text()).not.toMatch(/internals|D1_ERROR/);
    expect(JSON.stringify(err.mock.calls)).not.toContain(cookie);
    err.mockRestore();
  });

  it('never echoes the secret in any response', async () => {
    const { call, visit } = await setup();
    const { res, cookie } = await visit();
    const texts = [await res.clone().text(), JSON.stringify([...res.headers]), await (await call(post('yes', cookie))).text()];
    for (const t of texts) expect(t).not.toContain(SECRET);
  });
});
