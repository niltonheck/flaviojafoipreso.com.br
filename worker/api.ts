import { newVoterId, rateKey, signVoterCookie, verifyVoterCookie, voterHash } from './crypto.ts';
import { getStatus, latestNews } from './siteState.ts';
import { brasiliaDay, currentPoll, insertVote, pollState, tally, viewerChoice, type PollRow, type Tally } from './poll.ts';
import type { Choice, Env } from './types.ts';

const COOKIE = 'fjfp_vid';
const COOKIE_MAX_AGE = 400 * 24 * 3600; // browsers cap cookie lifetime at ~400 days anyway
const MAX_BODY_BYTES = 1024;
const MIN_SECRET_LENGTH = 32;

export type ApiDeps = { now?: () => Date; cacheTtlMs?: number };

const headers = (extra: HeadersInit = {}) => ({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  ...extra,
});
const json = (status: number, body: unknown, extra?: HeadersInit) => new Response(JSON.stringify(body), { status, headers: headers(extra) });
const fail = (status: number, error: string, extra?: HeadersInit) => json(status, { error }, extra);

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export function createApi(deps: ApiDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const ttl = deps.cacheTtlMs ?? 15_000;
  // Anonymous aggregate counts only. Per-viewer state is always resolved fresh and never cached.
  const cache = new Map<string, { at: number; value: Tally }>();
  let siteCache: { at: number; value: unknown } | null = null;

  async function counts(env: Env, poll: PollRow, day: string | null, fresh = false): Promise<Tally> {
    const k = `${poll.id}|${day ?? 'all'}`;
    const hit = cache.get(k);
    if (!fresh && hit && now().getTime() - hit.at < ttl) return hit.value;
    const value = await tally(env.DB, poll.id, day);
    cache.set(k, { at: now().getTime(), value });
    return value;
  }

  /** Automated status + newest headlines (same for every viewer, so it may be cached briefly). Null until the job has run. */
  async function readSite(env: Env) {
    if (siteCache && now().getTime() - siteCache.at < ttl) return siteCache.value;
    const [s, n] = await Promise.all([getStatus(env.DB), latestNews(env.DB, 3)]);
    let evidence: unknown = [];
    try { evidence = JSON.parse(s?.evidence ?? '[]'); } catch { /* keep [] */ }
    const value = s
      ? {
          status: { status: s.status, checkedAt: s.checked_at, verifiedBy: s.verified_by, mode: s.mode, evidence },
          news: n.results.map((r) => ({ headline: r.headline, publishedAt: r.published_at, publisher: r.publisher, url: r.url })),
        }
      : null;
    siteCache = { at: now().getTime(), value };
    return value;
  }

  async function snapshot(env: Env, poll: PollRow, at: Date, voter: { id: string } | null, fresh = false) {
    const state = pollState(poll, at);
    // Open polls show today's tally; once closed, the whole poll.
    const day = state === 'closed' ? null : brasiliaDay(at);
    const t = state === 'upcoming' ? { yes: 0, no: 0 } : await counts(env, poll, day, fresh);
    const mine = voter && day && state === 'open'
      ? await viewerChoice(env.DB, poll.id, day, await voterHash(env.VOTER_HMAC_SECRET!, voter.id, poll.id, day))
      : null;
    return {
      id: poll.id,
      question: poll.question,
      startsAt: poll.starts_at,
      closesAt: poll.closes_at,
      state,
      day,
      yes: t.yes,
      no: t.no,
      total: t.yes + t.no,
      viewerHasVoted: mine !== null,
      viewerChoice: mine,
    };
  }

  function originAllowed(request: Request, env: Env): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    const allowed = new Set([new URL(request.url).origin, ...(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
    if (!allowed.has(origin)) return false;
    return request.headers.get('sec-fetch-site') !== 'cross-site';
  }

  const secretOk = (env: Env) => typeof env.VOTER_HMAC_SECRET === 'string' && env.VOTER_HMAC_SECRET.length >= MIN_SECRET_LENGTH;

  function unavailable(stage: string, e?: unknown) {
    // Sanitized: stage + error class only; no ids, cookies, IPs or bodies.
    console.error('poll_unavailable', { stage, kind: e instanceof Error ? e.name : typeof e });
    return fail(503, 'unavailable');
  }

  async function getCurrent(request: Request, env: Env): Promise<Response> {
    if (!secretOk(env)) return unavailable('config');
    const secret = env.VOTER_HMAC_SECRET!;
    try {
      const poll = await currentPoll(env.DB, now());
      if (!poll) return unavailable('no-poll');
      let id = await verifyVoterCookie(secret, readCookie(request, COOKIE));
      const extra: Record<string, string> = {};
      if (!id) {
        // First visit: issue a signed, HttpOnly voter cookie. The raw id is never stored server-side.
        id = newVoterId();
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        extra['set-cookie'] = `${COOKIE}=${await signVoterCookie(secret, id)}; Path=/api; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
      }
      const body = await snapshot(env, poll, now(), { id });
      // A failure reading the automated state must not break the poll: the page keeps its build-time snapshot.
      const site = env.AUTOMATION_ENABLED === 'true' ? await readSite(env).catch(() => null) : null;
      return json(200, site ? { ...body, site } : body, extra);
    } catch (e) {
      return unavailable('get', e);
    }
  }

  async function postVote(request: Request, env: Env, pollId: string): Promise<Response> {
    if (!originAllowed(request, env)) return fail(403, 'forbidden_origin');
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(415, 'unsupported_media_type');
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) return fail(413, 'payload_too_large');
    if (!secretOk(env)) return unavailable('config');
    const secret = env.VOTER_HMAC_SECRET!;

    // Rate limit before doing any work. Keys are non-reversible hashes held only by the limiter.
    if (env.VOTE_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const keys = [await rateKey(secret, 'ip', ip)];
      const raw = readCookie(request, COOKIE);
      if (raw) keys.push(await rateKey(secret, 'voter', raw));
      for (const key of keys) {
        if (!(await env.VOTE_LIMITER.limit({ key })).success) return fail(429, 'rate_limited', { 'retry-after': '60' });
      }
    }

    const id = await verifyVoterCookie(secret, readCookie(request, COOKIE));
    if (!id) return fail(400, 'invalid_voter');

    let text: string;
    try { text = await request.text(); } catch { return fail(400, 'invalid_body'); }
    if (text.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large');
    let body: unknown;
    try { body = JSON.parse(text); } catch { return fail(400, 'invalid_body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_body');
    const keys = Object.keys(body);
    const choice = (body as { choice?: unknown }).choice;
    if (keys.length !== 1 || (choice !== 'yes' && choice !== 'no')) return fail(400, 'invalid_body');

    try {
      const at = now();
      const poll = await currentPoll(env.DB, at);
      if (!poll || poll.id !== pollId) return fail(404, 'poll_not_found');
      const state = pollState(poll, at);
      if (state === 'closed') return fail(403, 'poll_closed');
      if (state === 'upcoming') return fail(403, 'poll_upcoming');

      const day = brasiliaDay(at);
      const hash = await voterHash(secret, id, poll.id, day);
      const outcome = await insertVote(env.DB, { pollId: poll.id, day, choice: choice as Choice, hash, now: at });
      if (outcome === 'duplicate') return fail(409, 'already_voted');
      cache.delete(`${poll.id}|${day}`);
      return json(201, await snapshot(env, poll, at, { id }, true));
    } catch (e) {
      return unavailable('vote', e);
    }
  }

  return {
    /** Returns null for non-API paths so the caller can serve static assets. */
    async handle(request: Request, env: Env): Promise<Response | null> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return null;
      const path = url.pathname.replace(/\/+$/, '');

      if (path === '/api/health') {
        if (request.method !== 'GET') return fail(405, 'method_not_allowed', { allow: 'GET' });
        try {
          await env.DB.prepare('SELECT 1 AS ok').first(); // proves the D1 binding works; says nothing else
          return json(200, { ok: true });
        } catch (e) {
          return unavailable('health', e);
        }
      }
      if (path === '/api/polls/current') {
        return request.method === 'GET' ? getCurrent(request, env) : fail(405, 'method_not_allowed', { allow: 'GET' });
      }
      const m = /^\/api\/polls\/([^/]+)\/votes$/.exec(path);
      if (m) {
        return request.method === 'POST' ? postVote(request, env, decodeURIComponent(m[1])) : fail(405, 'method_not_allowed', { allow: 'POST' });
      }
      return fail(404, 'not_found');
    },
  };
}
