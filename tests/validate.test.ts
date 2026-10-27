import { describe, expect, it } from 'vitest';
import { isTrustedHost, isValidDate, validateNews, validatePoll, validateStatus } from '../src/lib/validate.ts';
import type { NewsItem, StatusRecord } from '../src/lib/types.ts';

const trusted = ['globo.com', 'uol.com.br'];
const strict = { strict: true, trustedDomains: trusted, now: new Date('2026-10-27T12:00:00-03:00') };
const src = { title: 't', publisher: 'G1', url: 'https://g1.globo.com/a', publishedAt: '2026-10-26' };
const status = (o: Partial<StatusRecord> = {}): StatusRecord => ({
  subject: 'flavio-bolsonaro', status: 'no', checkedAt: '2026-10-27T09:00:00-03:00', verifiedBy: 'e', evidence: [src], ...o,
});
const news = (o: Partial<NewsItem> = {}): NewsItem => ({
  id: 'a', headline: 'h', publishedAt: '2026-10-26', source: { publisher: 'G1', url: 'https://g1.globo.com/a' },
  reviewedAt: '2026-10-27T09:00:00-03:00', reviewedBy: 'e', ...o,
});
const errors = (i: { level: string }[]) => i.filter((x) => x.level === 'error');

describe('validateStatus', () => {
  it('accepts a complete record', () => expect(errors(validateStatus(status(), strict))).toEqual([]));
  it('accepts unverified without evidence or date', () =>
    expect(errors(validateStatus(status({ status: 'unverified', checkedAt: null, evidence: [] }), strict))).toEqual([]));
  it.each(['yes', 'no'] as const)('rejects %s without checkedAt', (s) =>
    expect(errors(validateStatus(status({ status: s, checkedAt: null }), strict)).length).toBeGreaterThan(0));
  it.each(['yes', 'no'] as const)('rejects %s without evidence', (s) =>
    expect(errors(validateStatus(status({ status: s, evidence: [] }), strict)).length).toBeGreaterThan(0));
  it('rejects non-HTTPS evidence', () =>
    expect(errors(validateStatus(status({ evidence: [{ ...src, url: 'http://g1.globo.com/a' }] }), strict))).toHaveLength(1));
  it('rejects untrusted domains', () =>
    expect(errors(validateStatus(status({ evidence: [{ ...src, url: 'https://blog.example/a' }] }), strict))).toHaveLength(1));
  it('rejects a checkedAt without timezone, invalid, or in the future', () => {
    for (const checkedAt of ['2026-10-27T09:00:00', 'nope', '2026-10-28T09:00:00-03:00']) {
      expect(errors(validateStatus(status({ checkedAt }), strict)).length).toBeGreaterThan(0);
    }
  });
  it('warns when "yes" has a single source', () =>
    expect(validateStatus(status({ status: 'yes' }), strict).some((i) => i.level === 'warning')).toBe(true));
  it('demo fixtures may skip evidence', () =>
    expect(errors(validateStatus(status({ evidence: [] }), { ...strict, strict: false }))).toEqual([]));
});

describe('validateNews', () => {
  it('accepts valid news', () => expect(errors(validateNews([news()], strict))).toEqual([]));
  it('rejects duplicate ids', () => expect(errors(validateNews([news(), news()], strict)).length).toBeGreaterThan(0));
  it('rejects a source without a link', () =>
    expect(errors(validateNews([news({ source: { publisher: 'G1', url: '' } })], strict)).length).toBeGreaterThan(0));
  it('rejects invalid dates and missing review', () => {
    expect(errors(validateNews([news({ publishedAt: '26/10/2026' })], strict)).length).toBeGreaterThan(0);
    expect(errors(validateNews([news({ reviewedBy: '' })], strict)).length).toBeGreaterThan(0);
  });
  it('requires correctionOf to point at an existing item', () => {
    expect(errors(validateNews([news(), news({ id: 'b', correctionOf: 'a' })], strict))).toEqual([]);
    expect(errors(validateNews([news({ correctionOf: 'zzz' })], strict)).length).toBeGreaterThan(0);
  });
});

describe('validatePoll', () => {
  const poll = { id: 'p', question: 'q', startsAt: '2026-10-27T00:00:00-03:00', closesAt: '2027-10-27T23:59:59-03:00' };
  it('accepts a valid poll', () => expect(validatePoll(poll)).toEqual([]));
  it('rejects closesAt before startsAt', () =>
    expect(validatePoll({ ...poll, closesAt: '2026-01-01T00:00:00-03:00' }).length).toBeGreaterThan(0));
});

describe('helpers', () => {
  it('matches trusted domains and subdomains only', () => {
    expect(isTrustedHost('g1.globo.com', trusted)).toBe(true);
    expect(isTrustedHost('globo.com', trusted)).toBe(true);
    expect(isTrustedHost('evilglobo.com', trusted)).toBe(false);
    expect(isTrustedHost('globo.com.evil.io', trusted)).toBe(false);
  });
  it('validates ISO dates', () => {
    expect(isValidDate('2026-02-30T00:00:00Z', true)).toBe(false);
    expect(isValidDate('2026-10-27')).toBe(true);
  });
});
