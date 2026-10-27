import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cfg = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'));
const guard = (env: string) => spawnSync('node', ['scripts/check-wrangler.ts', env], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });

describe('wrangler.jsonc', () => {
  it('routes only /api/* through the Worker', () => expect(cfg.assets.run_worker_first).toEqual(['/api/*']));

  it('gives every environment its own D1, rate limiter and worker name', () => {
    for (const env of [cfg, cfg.env.staging, cfg.env.production]) {
      expect(env.d1_databases[0].binding).toBe('DB');
      expect(env.ratelimits[0].name).toBe('VOTE_LIMITER');
    }
    const dbs = [cfg, cfg.env.staging, cfg.env.production].map((e) => e.d1_databases[0].database_name);
    expect(new Set(dbs).size).toBe(3);
    expect(cfg.env.staging.name).not.toBe(cfg.env.production.name);
  });

  it('keeps staging private and production off workers.dev', () => {
    expect(cfg.env.staging.routes).toBeUndefined();
    expect(cfg.env.production.workers_dev).toBe(false);
    expect(cfg.env.production.routes[0].custom_domain).toBe(true);
  });

  it('contains no secrets: the HMAC secret is a Worker secret, never in config', () => {
    expect(JSON.stringify(cfg)).not.toMatch(/VOTER_HMAC_SECRET|api[_-]?token/i);
  });

  it('blocks deploys while D1 ids are placeholders', () => {
    for (const env of ['staging', 'production']) {
      const r = guard(env);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/placeholder/);
    }
  });

  it('rejects unknown environments', () => expect(guard('qa').status).toBe(1));
});
