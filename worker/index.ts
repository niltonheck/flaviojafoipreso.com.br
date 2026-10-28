import { buildMime } from './alert.ts';
import { createApi } from './api.ts';
import { handleScheduled } from './scheduled.ts';
import type { Env } from './types.ts';

const api = createApi();

/** Sends an alert through the Cloudflare send_email binding. Needs ALERTS, ALERT_TO (verified) and ALERT_FROM. */
async function sendMail(env: Env, subject: string, body: string): Promise<void> {
  if (!env.ALERTS || !env.ALERT_TO || !env.ALERT_FROM) return console.log('alert_skipped', { reason: 'email not configured' });
  const { EmailMessage } = await import('cloudflare:email');
  const raw = buildMime({ from: env.ALERT_FROM, to: env.ALERT_TO, subject, body, now: new Date(), messageId: `${crypto.randomUUID()}@flaviojafoipreso.com.br` });
  await env.ALERTS.send(new EmailMessage(env.ALERT_FROM, env.ALERT_TO, raw));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Static assets are served by the platform; only /api/* is routed here (see wrangler.jsonc).
    return (await api.handle(request, env)) ?? env.ASSETS.fetch(request);
  },

  /** Cron triggers (wrangler.jsonc): 05:00 UTC retention purge, editorial job 3x/day. */
  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(handleScheduled(event.cron, env, { sendMail }));
  },
};
