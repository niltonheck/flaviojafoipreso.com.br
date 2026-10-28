import feeds from '../src/data/feeds.json';
import { runEditorial, type Classify } from './editorial.ts';
import { classifyArrest } from './gemini.ts';
import { purgeOldVotes } from './retention.ts';
import type { Env } from './types.ts';

export const CRON_RETENTION = '0 5 * * *';
// 01:00, 09:00, 17:00 UTC = 22:00, 06:00, 14:00 Brasília: every 8 h. Keep AUTO_MAX_AGE_HOURS (src/lib/status.ts) in step.
export const CRON_EDITORIAL = '0 1,9,17 * * *';
/** Verification-only schedule: staging may add it temporarily to see a run within minutes. check-wrangler forbids it in production. */
export const CRON_EDITORIAL_TEST = '*/2 * * * *';

export type SchedulerDeps = {
  now?: () => Date;
  fetchFn?: typeof fetch;
  /** Real implementation lives in index.ts (it needs the Workers-only `cloudflare:email` module). */
  sendMail?: (env: Env, subject: string, body: string) => Promise<void>;
};

/** Dispatches a cron trigger. Errors are logged without any identifying data and never thrown (no retry storms). */
export async function handleScheduled(cron: string, env: Env, d: SchedulerDeps = {}): Promise<void> {
  const now = d.now ?? (() => new Date());
  const fetchFn = d.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  if (cron === CRON_RETENTION) {
    try {
      console.log('retention', await purgeOldVotes(env.DB, now()));
    } catch (e) {
      console.error('retention_failed', { kind: e instanceof Error ? e.name : typeof e });
    }
    return;
  }

  if (cron === CRON_EDITORIAL || cron === CRON_EDITORIAL_TEST) {
    if (env.AUTOMATION_ENABLED !== 'true') return console.log('editorial', { skipped: 'AUTOMATION_ENABLED is not true' });
    const classify: Classify | undefined = env.GEMINI_API_KEY
      ? (items) => classifyArrest(items, { apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL, fetchFn })
      : undefined;
    // What the condition was BEFORE this run: a run that keeps crashing may transiently write "ok" first, so the crash
    // email is deduplicated against this, not against whatever the half-finished run left behind.
    const before = await (await import('./siteState.ts')).getStatus(env.DB).catch(() => null);
    try {
      const r = await runEditorial(env.DB, {
        now,
        fetchFn,
        feeds,
        classify,
        alert: d.sendMail ? (subject, body) => d.sendMail!(env, subject, body) : undefined,
      });
      console.log('editorial', { outcome: r.outcome, feedsOk: r.feedsOk, relevant: r.relevant, newNews: r.newNews });
    } catch (e) {
      console.error('editorial_failed', { kind: e instanceof Error ? e.name : typeof e });
      // The answer on the page never depends on the job, so a crash only needs to tell the editor (once).
      await reportCrash(env, now(), d, before?.reason).catch(() => {});
    }
  }
}

async function reportCrash(env: Env, now: Date, d: SchedulerDeps, reasonBefore: string | null | undefined) {
  const { getStatus, setStatus } = await import('./siteState.ts');
  const { alertFor } = await import('./editorial.ts');
  try {
    const prev = await getStatus(env.DB);
    if (prev?.status === 'yes') return; // a human-recorded "SIM" is never touched, and needs no crash email
    await setStatus(env.DB, { status: 'no', checked_at: prev?.checked_at ?? null, verified_by: 'auto-gemini', mode: 'auto', reason: 'job-crashed', evidence: '[]' }, now);
  } catch { /* the database itself is unreachable: still tell the editor below (at most 3 emails a day) */ }
  const mail = alertFor(reasonBefore, 'job-crashed', []);
  if (mail) await d.sendMail?.(env, mail.subject, mail.body).catch(() => {});
}
