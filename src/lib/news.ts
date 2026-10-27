import type { NewsItem } from './types.ts';

/** The three most recently published approved items, newest first. */
export const selectNews = (items: NewsItem[], limit = 3): NewsItem[] =>
  [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit);
