import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/lib/config.ts';
import { validateNews, validateStatus } from '../src/lib/validate.ts';
import status from '../src/data/status.json';
import news from '../src/data/news.json';
import trusted from '../src/data/trusted-sources.json';
import type { NewsItem, StatusRecord } from '../src/lib/types.ts';

describe('resolveConfig', () => {
  it('defaults to demo + mock poll', () => expect(resolveConfig({})).toMatchObject({ mode: 'demo', pollMode: 'mock', statusMaxAgeHours: 72 }));
  it('production defaults to the api poll', () => expect(resolveConfig({ MODE: 'production' }).pollMode).toBe('api'));
  it('refuses the mock poll in production', () => expect(() => resolveConfig({ MODE: 'production', PUBLIC_POLL_MODE: 'mock' })).toThrow());
  it('allows mock in staging', () => expect(resolveConfig({ MODE: 'staging', PUBLIC_POLL_MODE: 'mock' }).pollMode).toBe('mock'));
  it('rejects bad values', () => {
    expect(() => resolveConfig({ PUBLIC_POLL_MODE: 'x' })).toThrow();
    expect(() => resolveConfig({ PUBLIC_STATUS_MAX_AGE_HOURS: '0' })).toThrow();
  });
  it('footer automation wording is off unless PUBLIC_AUTOMATION is exactly "on"', () => {
    expect(resolveConfig({}).automation).toBe(false);
    expect(resolveConfig({ PUBLIC_AUTOMATION: 'true' }).automation).toBe(false);
    expect(resolveConfig({ PUBLIC_AUTOMATION: 'on' }).automation).toBe(true);
  });
  it('reads the freshness threshold', () => expect(resolveConfig({ PUBLIC_STATUS_MAX_AGE_HOURS: '24' }).statusMaxAgeHours).toBe(24));
});

describe('committed production content', () => {
  const o = { strict: true, trustedDomains: trusted.domains };
  it('is valid', () => {
    expect(validateStatus(status as StatusRecord, o).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateNews(news as NewsItem[], o).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('contains no placeholder text', () => expect(JSON.stringify([status, news])).not.toMatch(/ilustrativ|demo/i));
});
