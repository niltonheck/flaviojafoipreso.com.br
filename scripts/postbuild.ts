// Runs after `astro build`: writes dist/_headers (CSP with script hashes, cache rules) and dist/robots.txt.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { buildHeaders, buildRobots, inlineScriptHashes, type Mode } from './lib/headers.ts';

const mode = (process.argv[2] ?? 'production') as Mode;
if (!['demo', 'staging', 'production'].includes(mode)) { console.error(`✖ modo inválido: ${mode}`); process.exit(1); }

const dist = (p: string) => new URL(`../dist/${p}`, import.meta.url);
// Every page's inline scripts go into one policy (hashes are per script body, so sharing is safe).
const pages = readdirSync(dist(''), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.html'));
const hashes = [...new Set(pages.flatMap((e) => inlineScriptHashes(readFileSync(`${e.parentPath}/${e.name}`, 'utf8'))))];
writeFileSync(dist('_headers'), buildHeaders(mode, hashes));
writeFileSync(dist('robots.txt'), buildRobots(mode));
console.log(`✔ dist/_headers (${hashes.length} script hash(es)) e dist/robots.txt [${mode}]`);
