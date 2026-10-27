// Editor helper (SPEC C §3/§4): you pick the story, this fills in the boilerplate.
// It never decides what is true and never runs automatically; a human runs it and reviews the diff.
//   (keeps the page's full publication timestamp so same-day stories sort correctly; no publisher text is copied
//   unless you pass --summary)
//   npm run news:add -- <url> [--headline "…"] [--publisher "…"] [--date YYYY-MM-DD] [--summary "…"] [--dry-run]
//   npm run status:set -- <yes|no|unverified> [--source <url>]… [--note "…"] [--dry-run]
//   "no" needs no sources (just the check time); "yes" requires at least one trusted source.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EDITOR } from '../src/lib/config.ts';
import { brasiliaDay, parseMeta } from '../src/lib/meta.ts';
import { isTrustedHost, validateNews, validateStatus } from '../src/lib/validate.ts';
import type { NewsItem, Source, StatusRecord } from '../src/lib/types.ts';

const file = (p: string) => new URL(`../${p}`, import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(file(p), 'utf8'));
const trusted: string[] = read('src/data/trusted-sources.json').domains;

const BRT_OFFSET_MS = -3 * 3_600_000; // Brazil has had no DST since 2019
const nowBrasilia = () => new Date(Date.now() + BRT_OFFSET_MS).toISOString().replace(/\.\d+Z$/, '-03:00');
const die = (m: string): never => { console.error(`✖ ${m}`); process.exit(1); };

async function inspect(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return die(`URL inválida: ${url}`); }
  if (u.protocol !== 'https:') die('use uma URL HTTPS');
  if (!isTrustedHost(u.hostname, trusted)) die(`${u.hostname} não está em src/data/trusted-sources.json. Se o veículo é confiável, adicione o domínio lá.`);
  try {
    const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (editor-helper; +local)' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { console.warn(`⚠ HTTP ${res.status} ao ler a página; preencha os campos manualmente.`); return { url: u.href, meta: null }; }
    return { url: u.href, meta: parseMeta(await res.text()) };
  } catch (e) {
    console.warn(`⚠ não consegui ler a página (${(e as Error).message}); preencha os campos manualmente.`);
    return { url: u.href, meta: null };
  }
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const publisherFrom = (host: string) => host.replace(/^www\./, '');

function finish(label: string, path: string, data: unknown, issues: { level: string; path: string; message: string }[], dry: boolean) {
  for (const i of issues) console.log(`${i.level === 'error' ? '✖' : '⚠'} ${i.path}: ${i.message}`);
  console.log(JSON.stringify(data, null, 2));
  if (issues.some((i) => i.level === 'error')) die('entrada inválida; nada foi gravado.');
  if (dry) return console.log('\n(dry-run: nada foi gravado)');
  writeFileSync(file(path), JSON.stringify(data, null, 2) + '\n');
  console.log(`\n✔ ${label} gravado em ${path}. Revise o diff (git diff), faça commit e publique.`);
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'news') {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    headline: { type: 'string' }, publisher: { type: 'string' }, date: { type: 'string' }, summary: { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  if (positionals[0] !== 'add' || !positionals[1]) die('uso: npm run news:add -- <url> [--headline … --publisher … --date YYYY-MM-DD --summary …]');
  const { url, meta } = await inspect(positionals[1]);
  const items: NewsItem[] = read('src/data/news.json');
  if (items.some((n) => n.source.url === url)) die('essa URL já está em news.json');
  const headline = values.headline ?? meta?.title ?? die('não achei o título; use --headline');
  const publishedAt = values.date ?? meta?.publishedAt ?? die('não achei a data de publicação; use --date YYYY-MM-DD');
  const item: NewsItem = {
    id: `${brasiliaDay(publishedAt)}-${slug(headline)}`,
    headline,
    ...(values.summary ? { summary: values.summary } : {}),
    publishedAt,
    source: { publisher: values.publisher ?? meta?.siteName ?? publisherFrom(new URL(url).hostname), url },
    reviewedAt: nowBrasilia(),
    reviewedBy: EDITOR,
  };
  const next = [...items, item];
  finish('Notícia', 'src/data/news.json', next, validateNews(next, { strict: true, trustedDomains: trusted }), !!values['dry-run']);
} else if (cmd === 'status') {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    source: { type: 'string', multiple: true }, note: { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  const status = positionals[0] as StatusRecord['status'];
  if (!['yes', 'no', 'unverified'].includes(status)) die('uso: npm run status:set -- <yes|no|unverified> [--source <url>]… [--note "…"]');
  const prev: StatusRecord = read('src/data/status.json');
  // Only reuse previous sources when the status is unchanged (never carry "yes" evidence over to "no").
  let evidence: Source[] = prev.status === status ? prev.evidence : [];
  if (values.source?.length) {
    evidence = [];
    for (const s of values.source) {
      const { url, meta } = await inspect(s);
      evidence.push({
        title: meta?.title ?? die(`não achei o título de ${s}`),
        publisher: meta?.siteName ?? publisherFrom(new URL(url).hostname),
        url,
        publishedAt: meta?.publishedAt ?? die(`não achei a data de ${s}; edite status.json manualmente`),
        accessedAt: nowBrasilia(),
      });
    }
  } else if (status === 'yes' && evidence.length) {
    console.warn(`⚠ reutilizando ${evidence.length} fonte(s) anteriores. Confirme que ainda sustentam "yes".`);
  }
  const next: StatusRecord = {
    subject: 'flavio-bolsonaro', status, checkedAt: status === 'unverified' && !values.source ? null : nowBrasilia(),
    verifiedBy: EDITOR, evidence: status === 'unverified' ? [] : evidence,
    ...(values.note ? { editorialNote: values.note } : {}),
  };
  finish('Status', 'src/data/status.json', next, validateStatus(next, { strict: true, trustedDomains: trusted }), !!values['dry-run']);
} else {
  die('comandos: news add <url> | status <yes|no|unverified>');
}
