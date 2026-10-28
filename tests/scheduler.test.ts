import { describe, expect, it, vi } from 'vitest';
import { CRON_EDITORIAL, CRON_EDITORIAL_TEST, CRON_RETENTION, handleScheduled } from '../worker/scheduled.ts';
import { buildMime } from '../worker/alert.ts';
import { G1_A, NORMAL, NOW, allFeeds, fakeFetch } from './helpers/feeds.ts';
import { makeEnv } from './helpers/d1.ts';
import feeds from '../src/data/feeds.json';

const geminiOk = (verdict: object) => (): Response => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(verdict) }] } }] }));
const routes = (items = NORMAL, gemini?: () => Response) => ({
  ...Object.fromEntries(feeds.map((f) => [f.url, allFeeds(items)[Object.keys(allFeeds(items))[0]]])),
  ...(gemini ? { 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent': gemini } : {}),
});
const state = (raw: ReturnType<typeof makeEnv>['raw']) => raw.prepare('SELECT status, mode FROM status_state').get();

describe('kill switch', () => {
  it('does nothing at all unless AUTOMATION_ENABLED is exactly "true"', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '1', '']) {
      const { env, raw } = makeEnv({ AUTOMATION_ENABLED: flag, GEMINI_API_KEY: 'k' });
      const f = vi.fn(fakeFetch(routes()));
      await handleScheduled(CRON_EDITORIAL, env, { now: () => NOW, fetchFn: f });
      expect(f).not.toHaveBeenCalled();
      expect(state(raw)).toBeUndefined();
    }
  });
});

describe('editorial cron end to end (fake feeds + fake Gemini)', () => {
  it('runs the whole pipeline and renews "no"', async () => {
    const { env, raw } = makeEnv({ AUTOMATION_ENABLED: 'true', GEMINI_API_KEY: 'k' });
    await handleScheduled(CRON_EDITORIAL, env, { now: () => NOW, fetchFn: fakeFetch(routes(NORMAL, geminiOk({ arrest_reported: 'no', evidence: [] }))) });
    expect(state(raw)).toEqual({ status: 'no', mode: 'auto' });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM news_items').get()).toEqual({ n: 1 });
  });

  it('without a Gemini key it fails closed and emails', async () => {
    const { env, raw } = makeEnv({ AUTOMATION_ENABLED: 'true' });
    const sendMail = vi.fn(async () => {});
    await handleScheduled(CRON_EDITORIAL, env, { now: () => NOW, fetchFn: fakeFetch(routes()), sendMail });
    expect(state(raw)).toEqual({ status: 'unverified', mode: 'auto' });
    // first-ever run starting from "no" (none stored) -> unverified is a change worth an email
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it('a crash in the job itself drops to unverified instead of leaving a stale "NÃO."', async () => {
    const { env, raw } = makeEnv({ AUTOMATION_ENABLED: 'true', GEMINI_API_KEY: 'k' });
    raw.prepare("INSERT INTO status_state (id,status,checked_at,verified_by,mode,reason,evidence,updated_at) VALUES (1,'no','2026-10-28T10:00:00.000Z','auto-gemini','auto',NULL,'[]','x')").run();
    const real = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => { if (sql.includes('INSERT INTO editorial_runs')) throw new Error('db hiccup'); return real(sql); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleScheduled(CRON_EDITORIAL, env, { now: () => NOW, fetchFn: fakeFetch(routes(NORMAL, geminiOk({ arrest_reported: 'no', evidence: [] }))) });
    expect(state(raw)).toEqual({ status: 'unverified', mode: 'auto' });
    expect(JSON.stringify(err.mock.calls)).not.toContain('db hiccup'); // sanitized: error class only
    err.mockRestore();
  });

  it('a crash never overrides a human-held status', async () => {
    const { env, raw } = makeEnv({ AUTOMATION_ENABLED: 'true' });
    raw.prepare("INSERT INTO status_state (id,status,checked_at,verified_by,mode,reason,evidence,updated_at) VALUES (1,'yes','2026-10-28T10:00:00.000Z','editor','manual',NULL,'[]','x')").run();
    const real = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql: string) => { if (sql.includes('INSERT INTO editorial_runs')) throw new Error('x'); return real(sql); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleScheduled(CRON_EDITORIAL, env, { now: () => NOW, fetchFn: fakeFetch(routes()) });
    expect(state(raw)).toEqual({ status: 'yes', mode: 'manual' });
  });
});

describe('verification-only cron', () => {
  it('runs the same editorial job (so staging can be checked within minutes)', async () => {
    const { env, raw } = makeEnv({ AUTOMATION_ENABLED: 'true', GEMINI_API_KEY: 'k' });
    await handleScheduled(CRON_EDITORIAL_TEST, env, { now: () => NOW, fetchFn: fakeFetch(routes(NORMAL, geminiOk({ arrest_reported: 'no', evidence: [] }))) });
    expect(state(raw)).toEqual({ status: 'no', mode: 'auto' });
  });
});

describe('cron dispatch', () => {
  it('routes the daily cron to retention and ignores unknown crons', async () => {
    const { env } = makeEnv({ AUTOMATION_ENABLED: 'true' });
    const f = vi.fn(fakeFetch({}));
    await handleScheduled('*/5 * * * *', env, { fetchFn: f });
    await handleScheduled(CRON_RETENTION, env, { now: () => NOW, fetchFn: f });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('buildMime', () => {
  const m = buildMime({ from: 'a@x.br', to: 'b@y.com', subject: '[FJFP] Status caiu para NÃO VERIFICADO', body: 'Olá — ação\nlinha 2', now: NOW, messageId: 'id@x.br' });
  it('encodes a UTF-8 subject and base64 body with CRLF headers', () => {
    expect(m).toContain('Subject: =?UTF-8?B?');
    expect(m).toContain('Content-Transfer-Encoding: base64');
    expect(m).toContain('\r\n\r\n');
    expect(m.split('\r\n\r\n')[1]!.replace(/\r\n/g, '')).toBe(btoa(String.fromCharCode(...new TextEncoder().encode('Olá — ação\nlinha 2'))));
  });
  it('has no raw non-ASCII in the headers', () => expect(m.split('\r\n\r\n')[0]).toMatch(/^[\x20-\x7e\r\n]*$/));
  it('does not let a newline in the subject inject extra headers', () => {
    const evil = buildMime({ from: 'a@x.br', to: 'b@y.com', subject: 'x\r\nBcc: evil@z.com', body: 'b', now: NOW, messageId: 'i' });
    expect(evil).not.toMatch(/^Bcc:/m);
  });
});
