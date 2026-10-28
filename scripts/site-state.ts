// Human control of the automated status (docs/AUTOMATION.md). Talks to the remote D1 of an environment.
//   npm run site:show  -- --env staging
//   npm run site:hold  -- <yes|no|unverified> --env staging [--source <url>]…   a human owns the status; the job leaves it alone
//   npm run site:auto  -- --env staging                                         hand control back to the hourly job
// "yes" requires at least one trusted HTTPS source and is NEVER set by the job.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EDITOR } from '../src/lib/config.ts';
import { parseMeta } from '../src/lib/meta.ts';
import { isTrustedHost } from '../src/lib/validate.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { env: { type: 'string' }, source: { type: 'string', multiple: true } } });
const [cmd, arg] = positionals;
const env = values.env;
const die = (m: string): never => { console.error(`✖ ${m}`); process.exit(1); };
if (env !== 'staging' && env !== 'production') die('use --env staging|production');

const trusted: string[] = JSON.parse(readFileSync(new URL('../src/data/trusted-sources.json', import.meta.url), 'utf8')).domains;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`; // SQL string literal
function d1(sql: string) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--env', env!, '--remote', '--json', '--command', sql], { encoding: 'utf8' });
  if (r.status !== 0) die(`wrangler falhou:\n${r.stderr || r.stdout}`);
  return r.stdout;
}
const nowBrt = () => new Date().toISOString();

if (cmd === 'show') {
  const out = JSON.parse(d1('SELECT status, checked_at, verified_by, mode, reason, evidence, updated_at FROM status_state; ')) as { results: unknown[] }[];
  console.log(JSON.stringify(out[0]?.results ?? [], null, 2));
  const news = JSON.parse(d1('SELECT published_at, publisher, headline FROM news_items ORDER BY published_at DESC LIMIT 5')) as { results: unknown[] }[];
  console.log(JSON.stringify(news[0]?.results ?? [], null, 2));
} else if (cmd === 'hold') {
  if (arg !== 'yes' && arg !== 'no' && arg !== 'unverified') die('uso: site:hold <yes|no|unverified> --env … [--source <url>]');
  const evidence: { publisher: string; title: string; url: string }[] = [];
  for (const s of values.source ?? []) {
    let u: URL;
    try { u = new URL(s); } catch { die(`URL inválida: ${s}`); }
    u = new URL(s);
    if (u.protocol !== 'https:' || !isTrustedHost(u.hostname, trusted)) die(`fonte não confiável ou não-HTTPS: ${s}`);
    const html = await (await fetch(s, { headers: { 'user-agent': 'Mozilla/5.0 (editor-helper; +local)' }, signal: AbortSignal.timeout(15_000) })).text();
    const m = parseMeta(html);
    evidence.push({ publisher: m.siteName ?? u.hostname.replace(/^www\./, ''), title: m.title ?? u.hostname, url: s });
  }
  if (arg === 'yes' && evidence.length === 0) die('"yes" exige ao menos uma --source confiável. O job nunca define "SIM".');
  const checkedAt = arg === 'unverified' ? 'NULL' : q(nowBrt());
  d1(`INSERT INTO status_state (id,status,checked_at,verified_by,mode,reason,evidence,updated_at) VALUES (1,${q(arg)},${checkedAt},${q(EDITOR)},'manual','manual-hold',${q(JSON.stringify(evidence))},${q(nowBrt())})
      ON CONFLICT (id) DO UPDATE SET status=excluded.status, checked_at=excluded.checked_at, verified_by=excluded.verified_by, mode='manual', reason='manual-hold', evidence=excluded.evidence, updated_at=excluded.updated_at`);
  console.log(`✔ ${env}: status "${arg}" definido manualmente (o job automático não vai alterá-lo até você rodar site:auto).`);
} else if (cmd === 'auto') {
  d1(`UPDATE status_state SET mode='auto', status='unverified', checked_at=NULL, verified_by='auto-gemini', reason='handed-back', evidence='[]', updated_at=${q(nowBrt())} WHERE id=1`);
  console.log(`✔ ${env}: controle devolvido ao job. O status fica "NÃO VERIFICADO" até a próxima execução horária.`);
} else die('comandos: show | hold <yes|no|unverified> | auto');
