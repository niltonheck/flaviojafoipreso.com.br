import { createHash } from 'node:crypto';

export type Mode = 'demo' | 'staging' | 'production';

/** sha256 of every inline <script> body, in CSP `'sha256-…'` form. */
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    out.add(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return [...out];
}

export function csp(scriptHashes: string[]): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'", // the poll bar width is set via a style attribute
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

/** Cloudflare Workers Assets `_headers` file. Rules are additive, so Cache-Control is set only on specific paths. */
export function buildHeaders(mode: Mode, scriptHashes: string[]): string {
  const security = [
    `Content-Security-Policy: ${csp(scriptHashes)}`,
    'Strict-Transport-Security: max-age=31536000',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy: same-origin',
    ...(mode === 'production' ? [] : ['X-Robots-Tag: noindex, nofollow']),
  ];
  const rule = (path: string, lines: string[]) => `${path}\n${lines.map((l) => `  ${l}`).join('\n')}\n`;
  return [
    rule('/*', security),
    // HTML: short cache so an editorial change/correction is live quickly (and can still be purged).
    rule('/', ['Cache-Control: public, max-age=60, must-revalidate']),
    rule('/index.html', ['Cache-Control: public, max-age=60, must-revalidate']),
    // Fingerprinted by the build: safe to cache forever.
    rule('/_astro/*', ['Cache-Control: public, max-age=31536000, immutable']),
    // Not fingerprinted: a day, so a replaced image shows up soon.
    rule('/images/*', ['Cache-Control: public, max-age=86400']),
  ].join('\n');
}

export function buildRobots(mode: Mode): string {
  return mode === 'production' ? 'User-agent: *\nAllow: /\nDisallow: /api/\n' : 'User-agent: *\nDisallow: /\n';
}
