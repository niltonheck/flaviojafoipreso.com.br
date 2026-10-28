import trusted from '../src/data/trusted-sources.json';
import { isTrustedHost } from '../src/lib/validate.ts';

export type Feed = { id: string; url: string; publisher: string };
export type FeedItem = { feed: string; publisher: string; title: string; url: string; publishedAt: string | null; description: string };
export type FeedResult = { feed: string; publisher: string; ok: boolean; newest: string | null; items: FeedItem[] };

const MAX_BYTES = 2_000_000;
const MAX_ITEMS = 200;

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const clean = (s: string) =>
  decode(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const ITEM = /<item[\s>][\s\S]*?<\/item>/gi;
const tagRe = (name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
const TITLE = tagRe('title');
const LINK = tagRe('link');
const DESC = tagRe('description');
const PUB = tagRe('pubDate');

const toIso = (s: string | undefined) => {
  const t = s ? Date.parse(clean(s)) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** Real article URL: unwraps redirect wrappers ("…/*https://…"), forces https, drops tracking, requires a trusted domain. */
export function canonicalUrl(link: string): string | null {
  const star = link.lastIndexOf('*http');
  const raw = (star >= 0 ? link.slice(star + 1) : link).trim();
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:' || !isTrustedHost(u.hostname, trusted.domains)) return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|rss)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return null;
  }
}

export function parseFeed(xml: string, feed: Pick<Feed, 'id' | 'publisher'>): FeedResult {
  const newest = toIso(PUB.exec(xml)?.[1]) ?? toIso(tagRe('lastBuildDate').exec(xml)?.[1]);
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(ITEM)) {
    if (items.length >= MAX_ITEMS) break;
    const block = m[0];
    const title = clean(TITLE.exec(block)?.[1] ?? '');
    const url = canonicalUrl(clean(LINK.exec(block)?.[1] ?? ''));
    if (!title || !url) continue;
    items.push({ feed: feed.id, publisher: feed.publisher, title, url, publishedAt: toIso(PUB.exec(block)?.[1]), description: clean(DESC.exec(block)?.[1] ?? '').slice(0, 500) });
  }
  return { feed: feed.id, publisher: feed.publisher, ok: true, newest, items };
}

/** Fetches every feed in parallel; a feed that errors, times out or is not XML-ish counts as not ok. */
export async function fetchFeeds(feeds: Feed[], fetchFn: typeof fetch, timeoutMs = 8000): Promise<FeedResult[]> {
  return Promise.all(
    feeds.map(async (f): Promise<FeedResult> => {
      try {
        const res = await fetchFn(f.url, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; fjfp-editorial/1.0; +https://flaviojafoipreso.com.br)', accept: 'application/rss+xml, application/xml, text/xml' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { feed: f.id, publisher: f.publisher, ok: false, newest: null, items: [] };
        const text = (await res.text()).slice(0, MAX_BYTES);
        if (!/<(rss|feed|channel)[\s>]/i.test(text)) return { feed: f.id, publisher: f.publisher, ok: false, newest: null, items: [] };
        return parseFeed(text, f);
      } catch {
        return { feed: f.id, publisher: f.publisher, ok: false, newest: null, items: [] };
      }
    }),
  );
}
