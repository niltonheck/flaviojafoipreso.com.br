import { createApi } from './api.ts';
import type { Env } from './types.ts';

const api = createApi();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Static assets are served by the platform; only /api/* is routed here (see wrangler.jsonc).
    return (await api.handle(request, env)) ?? env.ASSETS.fetch(request);
  },
};
