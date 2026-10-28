import feeds from '../src/data/feeds.json';
import { runEditorial, type Classify } from './editorial.ts';
import { classifyArrest } from './gemini.ts';
import { purgeOldVotes } from './retention.ts';
import type { Env } from './types.ts';

export const CRON_RETENTION = '0 5 * * *';
export const CRON_EDITORIAL = '0 * * * *';

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

  if (cron === CRON_EDITORIAL) {
    if (env.AUTOMATION_ENABLED !== 'true') return console.log('editorial', { skipped: 'AUTOMATION_ENABLED is not true' });
    const classify: Classify | undefined = env.GEMINI_API_KEY
      ? (items) => classifyArrest(items, { apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL, fetchFn })
      : undefined;
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
      // Fail closed even if the job itself crashed: do not leave a possibly stale "NÃO." standing.
      await failClosed(env, now(), d).catch(() => {});
    }
  }
}

async function failClosed(env: Env, now: Date, d: SchedulerDeps) {
  const { getStatus, setStatus } = await import('./siteState.ts');
  const prev = await getStatus(env.DB);
  if (prev?.mode === 'manual') return;
  await setStatus(env.DB, { status: 'unverified', checked_at: null, verified_by: 'auto-gemini', mode: 'auto', reason: 'job-crashed', evidence: '[]' }, now);
  if (prev?.status !== 'unverified') await d.sendMail?.(env, '[FJFP] Status caiu para NÃO VERIFICADO', 'O job automático falhou inesperadamente; o site passou a mostrar "NÃO VERIFICADO".').catch(() => {});
}
