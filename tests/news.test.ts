import { describe, expect, it } from 'vitest';
import { selectNews } from '../src/lib/news.ts';
import { parseMeta } from '../src/lib/meta.ts';
import type { NewsItem } from '../src/lib/types.ts';

const item = (id: string, publishedAt: string): NewsItem => ({
  id, headline: id, publishedAt, source: { publisher: 'p', url: 'https://g1.globo.com/' }, reviewedAt: '2026-10-27T09:00:00-03:00', reviewedBy: 'e',
});

describe('selectNews', () => {
  it('sorts newest first and caps at three', () => {
    const out = selectNews([item('a', '2026-01-01'), item('b', '2026-03-01'), item('c', '2026-02-01'), item('d', '2026-04-01')]);
    expect(out.map((n) => n.id)).toEqual(['d', 'b', 'c']);
  });
  it('returns fewer when fewer exist, and [] when empty (never padded)', () => {
    expect(selectNews([item('a', '2026-01-01')])).toHaveLength(1);
    expect(selectNews([])).toEqual([]);
  });
  it('does not mutate its input', () => {
    const input = [item('a', '2026-01-01'), item('b', '2026-03-01')];
    selectNews(input);
    expect(input[0].id).toBe('a');
  });
});

describe('parseMeta', () => {
  it('reads Open Graph, either attribute order, and decodes entities', () => {
    const html = `<head><meta property="og:title" content="A &amp; B"><meta content="G1" property="og:site_name">
      <meta property="article:published_time" content="2026-10-26T10:00:00-03:00"></head>`;
    expect(parseMeta(html)).toMatchObject({ title: 'A & B', siteName: 'G1', publishedAt: '2026-10-26T10:00:00-03:00' });
  });
  it('falls back to <title> and JSON-LD', () => {
    expect(parseMeta('<title>Oi</title><script>{"datePublished":"2026-10-01"}</script>')).toMatchObject({ title: 'Oi', publishedAt: '2026-10-01' });
  });
});
