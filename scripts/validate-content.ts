// Content integrity gate (SPEC C §3). Run via `npm run validate`; fails the build on any error.
import { readFileSync } from 'node:fs';
import { validateNews, validatePoll, validateStatus, type Issue, type Options } from '../src/lib/validate.ts';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const trusted: string[] = read('src/data/trusted-sources.json').domains;
const strict: Options = { strict: true, trustedDomains: trusted };
const loose: Options = { strict: false, trustedDomains: trusted };

const sets: [string, Issue[]][] = [
  ['src/data/status.json', validateStatus(read('src/data/status.json'), strict)],
  ['src/data/news.json', validateNews(read('src/data/news.json'), strict)],
  ['src/data/poll.json', validatePoll(read('src/data/poll.json'))],
  ['demo fixtures: status', validateStatus(read('src/data/fixtures/demo/status.json'), loose)],
  ['demo fixtures: news', validateNews(read('src/data/fixtures/demo/news.json'), loose)],
];

let errors = 0;
for (const [name, issues] of sets) {
  for (const i of issues) {
    if (i.level === 'error') errors++;
    console.log(`${i.level === 'error' ? '✖' : '⚠'} ${name} · ${i.path}: ${i.message}`);
  }
}
if (errors) {
  console.error(`\n${errors} erro(s) de conteúdo. Build interrompido.`);
  process.exit(1);
}
console.log('✔ conteúdo válido');
