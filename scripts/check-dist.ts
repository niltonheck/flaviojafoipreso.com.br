// Static output check (SPEC C §10 tests 5 and 7): a production build must never contain demo content.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const mode = process.argv[2] ?? 'production';
const html = new URL('../dist/index.html', import.meta.url);
if (!existsSync(html)) { console.error('✖ dist/index.html não existe'); process.exit(1); }
const assets = new URL('../dist/_astro/', import.meta.url);
const js = existsSync(assets)
  ? readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, assets), 'utf8')).join('\n')
  : '';
const text = readFileSync(html, 'utf8') + '\n' + js; // inline scripts and bundled chunks both count

const checks: [string, boolean][] = [
  ['lang="pt-BR"', text.includes('lang="pt-BR"')],
  ['aviso de sátira', text.includes('Não é fonte oficial')],
];
if (mode !== 'demo') {
  for (const needle of ['votos simulados', 'DEMONSTRAÇÃO', 'Manchete ilustrativa', 'Exibição de demonstração', 'MockPollRepository', 'fjfp-demo', 'sessionStorage', 'votos simulados']) {
    checks.push([`sem "${needle}"`, !text.includes(needle)]);
  }
}
const bad = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? '✔' : '✖'} ${name}`);
if (bad.length) process.exit(1);

// ---- headers, robots, indexing, secrets (SPEC C §7-§8, §10 test 8) ----
const more: [string, boolean][] = [];
const everythingHtml = () => readdirSync(new URL('../dist/', import.meta.url), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => readFileSync(`${e.parentPath}/${e.name}`, 'utf8')).join('\n');
const read = (p: string) => (existsSync(new URL(`../dist/${p}`, import.meta.url)) ? readFileSync(new URL(`../dist/${p}`, import.meta.url), 'utf8') : '');
const headersFile = read('_headers');
const robots = read('robots.txt');
const pageHtml = read('index.html');
more.push(['_headers com CSP', headersFile.includes('Content-Security-Policy')]);
more.push(['sem inline handlers (CSP)', !/\son[a-z]+\s*=\s*["']/i.test(pageHtml)]);
if (mode === 'production') {
  more.push(['robots.txt permite indexação', robots.includes('Allow: /')]);
  more.push(['sem noindex em produção', !pageHtml.includes('noindex') && !headersFile.includes('X-Robots-Tag')]);
} else {
  more.push(['robots.txt bloqueia tudo', robots.includes('Disallow: /\n')]);
  more.push(['noindex no HTML e no header', pageHtml.includes('noindex') && headersFile.includes('X-Robots-Tag: noindex')]);
}
if (mode === 'staging') more.push(['banner de ambiente de teste', pageHtml.includes('Ambiente de teste')]);
if (mode !== 'staging') more.push(['sem banner de teste', !pageHtml.includes('Ambiente de teste')]);

// The privacy page must exist, and production must not ship with unfilled [PREENCHER] placeholders.
const privacy = read('privacidade/index.html');
more.push(['página /privacidade existe', privacy.includes('Privacidade e como a enquete funciona')]);
more.push(['og:image absoluto e neutro (sem resposta no título)', /property="og:image" content="https:\/\/[^"]+\/og-image\.png"/.test(pageHtml) && !/og:title" content="[^"]*(NÃO|SIM)\b/.test(pageHtml)]);
if (mode === 'production') more.push(['canonical presente só em produção', pageHtml.includes('rel="canonical"') && read('sitemap.xml').includes('<loc>https://flaviojafoipreso.com.br/</loc>')]);
if (mode !== 'production') more.push(['sem canonical fora de produção', !pageHtml.includes('rel="canonical"')]);
if (mode === 'production') more.push(['sem campos [PREENCHER] no site', !everythingHtml().includes('[PREENCHER')]);

// No secret-looking PUBLIC_ variables, and no secret value or name anywhere in the output.
const SECRETISH = /SECRET|TOKEN|PASSWORD|PRIVATE|API_?KEY/i;
const leakyVars = Object.keys(process.env).filter((k) => k.startsWith('PUBLIC_') && SECRETISH.test(k));
more.push(['nenhuma variável PUBLIC_ com cara de segredo', leakyVars.length === 0]);

const secrets: string[] = [];
for (const f of ['.dev.vars']) {
  const p = new URL(`../${f}`, import.meta.url);
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*)=(.+)$/.exec(line.trim());
    if (m && m[3].length >= 8) secrets.push(m[3]);
  }
}
const distDir = new URL('../dist/', import.meta.url);
const textFiles = readdirSync(distDir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /(\.(html|js|css|json|txt|svg|xml)|_headers)$/.test(e.name))
  .map((e) => `${e.parentPath}/${e.name}`);
const everything = textFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
more.push(['segredos do .dev.vars ausentes do build', secrets.every((v) => !everything.includes(v))]);
more.push(['nenhuma menção a VOTER_HMAC_SECRET no build', !everything.includes('VOTER_HMAC_SECRET')]);
more.push(['sem .dev.vars / .wrangler em dist', !existsSync(new URL('../dist/.dev.vars', import.meta.url)) && !existsSync(new URL('../dist/.wrangler', import.meta.url))]);

for (const [name, ok] of more) console.log(`${ok ? '✔' : '✖'} ${name}`);
if (more.some(([, ok]) => !ok)) process.exit(1);
