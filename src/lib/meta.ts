export type PageMeta = { title: string | null; siteName: string | null; publishedAt: string | null; description: string | null };

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();

function meta(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (k?.toLowerCase() !== key) continue;
    const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = c?.[1] ?? c?.[2];
    if (v) return decode(v);
  }
  return null;
}

/** Best-effort read of a page's own metadata, to pre-fill an editor's entry. Never a source of truth. */
export function parseMeta(html: string): PageMeta {
  const ld = /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return {
    title: meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? (titleTag ? decode(titleTag) : null),
    siteName: meta(html, 'og:site_name'),
    publishedAt: meta(html, 'article:published_time') ?? ld,
    description: meta(html, 'og:description') ?? meta(html, 'description'),
  };
}
