import { describe, expect, it } from 'vitest';
import { selectNews } from '../src/lib/news.ts';
import { brasiliaDay, cleanTitle, normalizeTimestamp, parseMeta, reconcileTimestamp } from '../src/lib/meta.ts';
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
  it('reads itemprop=datePublished (G1) and the page-JSON published_at (Estadão)', () => {
    expect(parseMeta('<meta itemprop="datePublished" content="2026-10-27T11:00:49.306-03:00">').publishedAt).toBe('2026-10-27T11:00:49.306-03:00');
    expect(parseMeta('..."published_at":"2026-10-27T14:21:50.173Z","x":1... "published_at":"2026-10-27T15:00:00Z"').publishedAt).toBe('2026-10-27T14:21:50.173Z');
  });
  it('prefers article:published_time over the fallbacks', () => {
    expect(parseMeta('<meta property="article:published_time" content="A"><meta itemprop="datePublished" content="B">').publishedAt).toBe('A');
  });
  it('strips a trailing site-name suffix from the title', () => {
    expect(parseMeta('<meta property="og:title" content="Manchete | G1"><meta property="og:site_name" content="G1">').title).toBe('Manchete');
    expect(cleanTitle('A | B | G1', 'G1')).toBe('A | B');
    expect(cleanTitle('Sem sufixo', 'G1')).toBe('Sem sufixo');
    expect(cleanTitle('G1', 'G1')).toBe('G1');
  });
});

describe('brasiliaDay', () => {
  it('uses the Brasília calendar day, not the UTC one', () => {
    expect(brasiliaDay('2026-10-28T01:00:00Z')).toBe('2026-10-27');
    expect(brasiliaDay('2026-10-27T11:21:14.000Z')).toBe('2026-10-27');
    expect(brasiliaDay('2026-10-27T00:30:00-03:00')).toBe('2026-10-27');
  });
  it('leaves date-only values alone', () => expect(brasiliaDay('2026-10-26')).toBe('2026-10-26'));
});

describe('normalizeTimestamp', () => {
  it('treats zone-less timestamps as Brasília time (Folha style)', () => {
    expect(normalizeTimestamp('2026-10-27 11:19:00')).toBe('2026-10-27T11:19:00-03:00');
    expect(normalizeTimestamp('2026-10-27T11:19')).toBe('2026-10-27T11:19-03:00');
  });
  it('leaves zoned, date-only and empty values untouched', () => {
    expect(normalizeTimestamp('2026-10-27T11:00:49.306-03:00')).toBe('2026-10-27T11:00:49.306-03:00');
    expect(normalizeTimestamp('2026-10-27T14:21:50.173Z')).toBe('2026-10-27T14:21:50.173Z');
    expect(normalizeTimestamp('2026-10-27')).toBe('2026-10-27');
    expect(normalizeTimestamp(null)).toBeNull();
  });
  it('parseMeta applies it', () =>
    expect(parseMeta('<meta property="article:published_time" content="2026-10-27 11:19:00">').publishedAt).toBe('2026-10-27T11:19:00-03:00'));
});

describe('reconcileTimestamp', () => {
  const now = new Date('2026-10-27T23:10:00-03:00');
  it('prefers the feed over a page tag with the wrong zone (Agência Brasil case)', () => {
    const r = reconcileTimestamp({ page: '2026-10-27T23:55:00-03:00', feed: '2026-10-27T23:55:00.000Z', now });
    expect(r.value).toBe('2026-10-27T23:55:00.000Z');
    expect(r.error).toBeUndefined();
  });
  it('flags a real feed/page disagreement, and uses the page when no feed has the article', () => {
    const disagree = reconcileTimestamp({ page: '2026-10-27T10:00:00-03:00', feed: '2026-10-27T16:00:00.000Z', now });
    expect(disagree.value).toBe('2026-10-27T16:00:00.000Z');
    expect(disagree.note).toMatch(/usando o feed/);
    expect(reconcileTimestamp({ page: '2026-10-27T10:00:00-03:00', feed: null, now }).value).toBe('2026-10-27T10:00:00-03:00');
  });
  it('does not complain when they agree', () => expect(reconcileTimestamp({ page: '2026-10-27T10:00:00-03:00', feed: '2026-10-27T13:00:00.000Z', now: new Date('2026-10-28T00:00:00Z') }).note).toBeUndefined());
  it('rejects a time in the future, wherever it came from', () => {
    expect(reconcileTimestamp({ page: '2026-10-27T23:55:00-03:00', feed: null, now }).error).toMatch(/futuro/);
    expect(reconcileTimestamp({ page: null, feed: '2026-10-28T09:00:00Z', now }).error).toMatch(/futuro/);
  });
  it('allows a few minutes of clock skew', () => expect(reconcileTimestamp({ page: '2026-10-27T23:13:00-03:00', feed: null, now }).error).toBeUndefined());
  it('handles nothing at all', () => expect(reconcileTimestamp({ page: null, feed: null, now }).value).toBeNull());
});
