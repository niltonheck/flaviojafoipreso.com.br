// Post-deploy smoke test against a live URL (SPEC C §10 ops checklist). Read-only: never votes.
//   npm run health:staging -- https://<worker>.workers.dev [--expect=staging|production]
const [base, ...flags] = process.argv.slice(2);
const expect = (flags.find((f) => f.startsWith('--expect=')) ?? '--expect=staging').split('=')[1];
if (!base || !/^(https:\/\/|http:\/\/localhost)/.test(base)) { console.error('uso: health.ts https://<host> (ou http://localhost:…) [--expect=staging|production]'); process.exit(1); }

const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => results.push([name, ok, detail]);
const origin = base.replace(/\/+$/, '');
const secureCookie = origin.startsWith('https://'); // Secure can't be set over plain-http localhost

try {
  const health = await fetch(`${origin}/api/health`);
  check('GET /api/health = 200 {ok:true}', health.status === 200 && (await health.json()).ok === true, `status ${health.status}`);

  const poll = await fetch(`${origin}/api/polls/current`);
  const body = await poll.json().catch(() => ({}));
  check('GET /api/polls/current = 200', poll.status === 200, `status ${poll.status}`);
  check('poll: forma e contagens numéricas', typeof body.id === 'string' && Number.isInteger(body.yes) && Number.isInteger(body.no), JSON.stringify(body).slice(0, 80));
  check('poll: sem cache compartilhado', /no-store/.test(poll.headers.get('cache-control') ?? ''));
  const cookie = poll.headers.get('set-cookie') ?? '';
  check('poll: cookie HttpOnly + SameSite' + (secureCookie ? ' + Secure' : ''), /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && (!secureCookie || /Secure/.test(cookie)));
  if (expect === 'staging') check('poll: id de staging (fictício)', String(body.id).startsWith('staging-'), String(body.id));
  if (expect === 'production') check('poll: id de produção', !String(body.id).startsWith('staging-'), String(body.id));

  const page = await fetch(`${origin}/`);
  const html = await page.text();
  check('GET / = 200 em pt-BR', page.status === 200 && html.includes('lang="pt-BR"'));
  check('CSP presente', !!page.headers.get('content-security-policy'));
  check('HSTS presente', !!page.headers.get('strict-transport-security'));
  check('nosniff presente', page.headers.get('x-content-type-options') === 'nosniff');
  const indexable = !/noindex/i.test(page.headers.get('x-robots-tag') ?? '') && !html.includes('noindex');
  check(expect === 'production' ? 'indexável em produção' : 'noindex fora de produção', expect === 'production' ? indexable : !indexable);

  const cross = await fetch(`${origin}/api/polls/${body.id}/votes`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"choice":"yes"}' });
  check('POST de origem estranha é recusado (403)', cross.status === 403, `status ${cross.status}`);
} catch (e) {
  check('site acessível', false, (e as Error).message);
}
for (const [n, ok, d] of results) console.log(`${ok ? '✔' : '✖'} ${n}${ok || !d ? '' : `  (${d})`}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
