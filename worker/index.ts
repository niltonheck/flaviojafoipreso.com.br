import { createApi } from './api.ts';
import { purgeOldVotes } from './retention.ts';
import type { Env } from './types.ts';

const api = createApi();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Static assets are served by the platform; only /api/* is routed here (see wrangler.jsonc).
    return (await api.handle(request, env)) ?? env.ASSETS.fetch(request);
  },

  /** Daily cron (wrangler.jsonc `triggers.crons`): enforce the vote-code retention policy. */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(
      purgeOldVotes(env.DB, new Date()).then(
        (r) => console.log('retention', r), // counts and a date only: nothing identifying
        (e) => console.error('retention_failed', { kind: e instanceof Error ? e.name : typeof e }),
      ),
    );
  },
};
