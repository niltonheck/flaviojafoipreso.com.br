import { resolveConfig } from './config.ts';
import { formatBrasilia } from './status.ts';
import { selectNews } from './news.ts';
import type { DemoCounts, NewsItem, PollConfig, StatusRecord } from './types.ts';
import status from '../data/status.json';
import news from '../data/news.json';
import poll from '../data/poll.json';

/**
 * Single entry point for page content. Demo fixtures are only loaded in `demo` mode, so
 * staging/production builds can never render placeholder status, news or counts.
 */
export async function loadContent(now = new Date()) {
  const cfg = resolveConfig(import.meta.env);
  let record = status as StatusRecord;
  let items = news as NewsItem[];
  let demoCounts: DemoCounts | null = null;

  if (cfg.mode === 'demo') {
    const [s, n, c] = await Promise.all([
      import('../data/fixtures/demo/status.json'),
      import('../data/fixtures/demo/news.json'),
      import('../data/fixtures/demo/poll-counts.json'),
    ]);
    // Keep the demo's "last check" recent no matter when the build/dev server runs.
    record = { ...(s.default as StatusRecord), checkedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString() };
    items = n.default as NewsItem[];
    demoCounts = c.default as DemoCounts;
  }

  return {
    ...cfg,
    record,
    checkedAtLabel: record.checkedAt ? formatBrasilia(record.checkedAt) : null,
    news: selectNews(items),
    poll: poll as PollConfig,
    demoCounts,
  };
}
