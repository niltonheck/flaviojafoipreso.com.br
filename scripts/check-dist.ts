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
