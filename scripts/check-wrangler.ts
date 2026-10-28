// Deploy guard: refuse to deploy an environment that still has placeholder resource ids or unsafe settings.
import { readFileSync } from 'node:fs';

const envName = process.argv[2];
if (envName !== 'staging' && envName !== 'production') { console.error('uso: check-wrangler.ts <staging|production>'); process.exit(1); }

// wrangler.jsonc only uses full-line // comments, so this is enough (and URLs in strings are safe).
const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const cfg = JSON.parse(text);
const env = cfg.env?.[envName];
const problems: string[] = [];
if (!env) problems.push(`ambiente "${envName}" não existe em wrangler.jsonc`);
else {
  const db = env.d1_databases?.find((d: { binding: string }) => d.binding === 'DB');
  if (!db) problems.push('binding D1 "DB" ausente');
  else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(db.database_id) || /^0+(-0+)*$/.test(db.database_id)) {
    problems.push(`database_id de ${envName} ainda é placeholder (rode "wrangler d1 create" e cole o id; ver docs/DEPLOY.md)`);
  }
  const crons: string[] = env.triggers?.crons ?? [];
  if (!crons.includes('0 5 * * *')) problems.push('cron da retenção (0 5 * * *) ausente: sem ele os códigos de voto nunca são apagados');
  if (!crons.includes('0 1,9,17 * * *')) problems.push('cron editorial (0 1,9,17 * * *) ausente');
  if (!env.ratelimits?.some((r: { name: string }) => r.name === 'VOTE_LIMITER')) problems.push('binding VOTE_LIMITER ausente');
  if (envName === 'production' && crons.includes('*/2 * * * *')) problems.push('o cron de teste (*/2 * * * *) não pode ir para produção');
  if (envName === 'production' && env.workers_dev !== false) problems.push('produção não pode expor workers.dev');
  if (envName === 'production' && !env.routes?.length) problems.push('produção sem rota/domínio');
  if (envName === 'staging' && env.routes?.length) problems.push('staging não deve ter rota de domínio público');
  if (env.name === cfg.name && envName === 'staging') problems.push('staging precisa de nome de Worker próprio');
}
if (problems.length) { for (const p of problems) console.error(`✖ ${p}`); process.exit(1); }
console.log(`✔ wrangler.jsonc: ambiente ${envName} pronto para deploy`);
