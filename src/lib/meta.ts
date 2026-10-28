export type PageMeta = { title: string | null; siteName: string | null; publishedAt: string | null; description: string | null };

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();

function meta(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (k?.toLowerCase() !== key) continue;
    const c = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = c?.[1] ?? c?.[2];
    if (v) return decode(v);
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Makes a scraped timestamp valid ISO 8601 with a zone. Values without a zone ("2026-10-27 11:19:00",
 * as Folha publishes) are Brasília time on these sites, so they get -03:00; anything else is returned as-is.
 */
export function normalizeTimestamp(raw: string | null): string | null {
  if (!raw) return raw;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(raw.trim());
  return m ? `${m[1]}T${m[2]}-03:00` : raw.trim();
}

/**
 * Chooses the publication time. An article's own page tag can be wrong (Agência Brasil labels UTC as -03:00), while the
 * RSS feed's pubDate carries an explicit, correct offset, so the feed wins when the article appears in one.
 * A time in the future is never plausible and is rejected.
 */
export function reconcileTimestamp(o: { page: string | null; feed: string | null; now: Date }): { value: string | null; note?: string; error?: string } {
  const value = o.feed ?? o.page;
  if (!value) return { value: null };
  const t = Date.parse(value);
  if (!Number.isNaN(t) && t > o.now.getTime() + 5 * 60_000) {
    return { value: null, error: `data de publicação no futuro (${value}); a página provavelmente declara o fuso errado. Use --date.` };
  }
  const differs = o.feed && o.page && Math.abs(Date.parse(o.feed) - Date.parse(o.page)) > 5 * 60_000;
  return differs ? { value, note: `a página diz ${o.page}, mas o feed diz ${o.feed}; usando o feed.` } : { value };
}

/** Calendar day (YYYY-MM-DD) in Brasília time. Date-only inputs are returned as-is. */
export function brasiliaDay(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Drops a trailing " | G1" / " - Folha" style suffix that sites append to og:title. */
export function cleanTitle(title: string | null, siteName: string | null): string | null {
  if (!title || !siteName) return title;
  return title.replace(new RegExp(`\\s*[|\u2013\u2014-]\\s*${escapeRe(siteName)}\\s*$`, 'i'), '').trim() || title;
}

/**
 * Best-effort read of a page's own metadata, to pre-fill an editor's entry. Never a source of truth.
 * Date sources, in order: article:published_time, itemprop=datePublished (G1), JSON-LD datePublished,
 * then the first "published_at" in the page JSON (Estadão).
 */
export function parseMeta(html: string): PageMeta {
  const ld = /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  const pageJson = /"published_at"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const siteName = meta(html, 'og:site_name');
  return {
    title: cleanTitle(meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? (titleTag ? decode(titleTag) : null), siteName),
    siteName,
    publishedAt: normalizeTimestamp(meta(html, 'article:published_time') ?? meta(html, 'datepublished') ?? ld ?? pageJson),
    description: meta(html, 'og:description') ?? meta(html, 'description'),
  };
}
