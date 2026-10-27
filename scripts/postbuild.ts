// Runs after `astro build`: writes dist/_headers (CSP with script hashes, cache rules) and dist/robots.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildHeaders, buildRobots, inlineScriptHashes, type Mode } from './lib/headers.ts';

const mode = (process.argv[2] ?? 'production') as Mode;
if (!['demo', 'staging', 'production'].includes(mode)) { console.error(`✖ modo inválido: ${mode}`); process.exit(1); }

const dist = (p: string) => new URL(`../dist/${p}`, import.meta.url);
const hashes = inlineScriptHashes(readFileSync(dist('index.html'), 'utf8'));
writeFileSync(dist('_headers'), buildHeaders(mode, hashes));
writeFileSync(dist('robots.txt'), buildRobots(mode));
console.log(`✔ dist/_headers (${hashes.length} script hash(es)) e dist/robots.txt [${mode}]`);
