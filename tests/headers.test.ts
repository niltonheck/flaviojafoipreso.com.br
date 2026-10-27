import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildHeaders, buildRobots, csp, inlineScriptHashes } from '../scripts/lib/headers.ts';

const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

describe('inlineScriptHashes', () => {
  it('hashes each inline script body exactly, dedupes, and ignores external scripts', () => {
    const html = '<script type="module">var a=1</script><script>var b=2</script><script src="/x.js"></script><script type="module">var a=1</script>';
    expect(inlineScriptHashes(html).sort()).toEqual([hash('var a=1'), hash('var b=2')].sort());
  });
  it('returns nothing for a page without inline scripts', () => expect(inlineScriptHashes('<p>hi</p>')).toEqual([]));
});

describe('csp', () => {
  const p = csp([hash('x')]);
  it('is locked down by default', () => {
    for (const d of ["default-src 'none'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "connect-src 'self'"]) expect(p).toContain(d);
  });
  it('never allows unsafe-inline for scripts, eval, or third-party origins', () => {
    const script = p.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    expect(p).not.toMatch(/https?:\/\//);
    expect(script).toContain(hash('x'));
  });
});

describe('buildHeaders', () => {
  it('sets the baseline security headers everywhere', () => {
    const h = buildHeaders('production', []);
    for (const n of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'Referrer-Policy', 'Permissions-Policy']) expect(h).toContain(n);
  });
  it('marks non-production environments noindex, and production indexable', () => {
    expect(buildHeaders('staging', [])).toContain('X-Robots-Tag: noindex');
    expect(buildHeaders('demo', [])).toContain('X-Robots-Tag: noindex');
    expect(buildHeaders('production', [])).not.toContain('X-Robots-Tag');
  });
  it('caches fingerprinted assets forever and HTML briefly (never the other way round)', () => {
    const h = buildHeaders('production', []);
    expect(h).toMatch(/\/_astro\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    expect(h).toMatch(/\/\n\s+Cache-Control: public, max-age=60, must-revalidate/);
    expect(h.match(/Cache-Control/g)).toHaveLength(5); // only on specific paths: no duplicate-merge surprises
  });
});

describe('buildRobots', () => {
  it('blocks everything outside production', () => {
    expect(buildRobots('staging')).toContain('Disallow: /\n');
    expect(buildRobots('demo')).toContain('Disallow: /\n');
  });
  it('allows the site but not the API in production', () => {
    const r = buildRobots('production');
    expect(r).toContain('Allow: /');
    expect(r).toContain('Disallow: /api/');
  });
});
