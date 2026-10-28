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

  it('schedules the retention and editorial jobs in every environment, and never the test cron in production', () => {
    for (const env of [cfg, cfg.env.staging, cfg.env.production]) expect(env.triggers.crons).toEqual(expect.arrayContaining(['0 5 * * *', '0 1,9,17 * * *']));
    expect(cfg.env.production.triggers.crons).toEqual(['0 5 * * *', '0 1,9,17 * * *']);
    expect(cfg.triggers.crons).toEqual(['0 5 * * *', '0 1,9,17 * * *']);
  });

  it('enables automation only in production, and holds no secrets or personal addresses in the config', () => {
    // Automation runs only where it was deliberately enabled: production. Local dev and staging are OFF
    // (staging is switched on only for verification, since it costs Gemini calls on every run).
    expect(cfg.vars.AUTOMATION_ENABLED).toBe('false');
    expect(cfg.env.staging.vars.AUTOMATION_ENABLED).toBe('false');
    expect(cfg.env.production.vars.AUTOMATION_ENABLED).toBe('true');
    for (const env of [cfg, cfg.env.staging, cfg.env.production]) {
      expect(env.send_email).toEqual([{ name: 'ALERTS' }]); // no destination_address: that stays a secret
      expect(JSON.stringify(env)).not.toMatch(/ALERT_TO|GEMINI_API_KEY|@gmail|@conbuss/i);
    }
  });

  it('contains no secrets: the HMAC secret is a Worker secret, never in config', () => {
    expect(JSON.stringify(cfg)).not.toMatch(/VOTER_HMAC_SECRET|api[_-]?token/i);
  });

  it('blocks deploys of any environment whose D1 id is still a placeholder, and allows configured ones', () => {
    for (const env of ['staging', 'production'] as const) {
      const placeholder = !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(cfg.env[env].d1_databases[0].database_id);
      const r = guard(env);
      if (placeholder) {
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/placeholder/);
      } else {
        expect(r.status).toBe(0);
      }
    }
  });

  it('gives production its own database, distinct from staging, and passes the deploy guard', () => {
    const ids = [cfg.env.staging, cfg.env.production].map((e) => e.d1_databases[0].database_id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(guard('production').status).toBe(0);
  });

  it('rejects unknown environments', () => expect(guard('qa').status).toBe(1));
});
