import { describe, expect, it } from 'vitest';
import { parseSite } from '../src/lib/site.ts';

const good = () => ({
  status: { status: 'no', checkedAt: '2026-10-28T14:00:00.000Z', verifiedBy: 'auto-gemini', mode: 'auto', evidence: [] },
  news: [{ headline: 'Manchete', publishedAt: '2026-10-28T13:00:00.000Z', publisher: 'G1', url: 'https://g1.globo.com/a.ghtml' }],
});

describe('parseSite (untrusted JSON before it reaches the DOM)', () => {
  it('accepts a well-formed payload', () => expect(parseSite(good())).toEqual(good()));
  it('reads a legacy "unverified" value as "no" (there is no third state) and accepts a null timestamp', () => {
    const r = parseSite({ status: { ...good().status, status: 'unverified', checkedAt: null }, news: [] });
    expect(r?.status.status).toBe('no');
    expect(r?.status.checkedAt).toBeNull();
  });

  it.each([
    ['null', null],
    ['not an object', 'x'],
    ['unknown status', { ...good(), status: { ...good().status, status: 'maybe' } }],
    ['unknown mode', { ...good(), status: { ...good().status, mode: 'robot' } }],
    ['bad timestamp', { ...good(), status: { ...good().status, checkedAt: 'yesterday' } }],
    ['missing evidence array', { ...good(), status: { ...good().status, evidence: undefined } }],
    ['javascript: evidence link', { ...good(), status: { ...good().status, evidence: [{ publisher: 'G1', url: 'javascript:alert(1)' }] } }],
    ['http news link', { ...good(), news: [{ ...good().news[0], url: 'http://g1.globo.com/a' }] }],
    ['news with empty headline', { ...good(), news: [{ ...good().news[0], headline: '' }] }],
    ['news with an absurdly long headline', { ...good(), news: [{ ...good().news[0], headline: 'x'.repeat(301) }] }],
  ])('rejects %s', (_n, raw) => expect(parseSite(raw)).toBeNull());

  it('never displays "yes" without a source', () => {
    expect(parseSite({ status: { ...good().status, status: 'yes' }, news: [] })).toBeNull();
    const withSource = { status: { ...good().status, status: 'yes', mode: 'manual', evidence: [{ publisher: 'G1', url: 'https://g1.globo.com/x' }] }, news: [] };
    expect(parseSite(withSource)?.status.status).toBe('yes');
  });

  it('caps list sizes', () => {
    const many = { ...good(), news: Array.from({ length: 50 }, () => good().news[0]) };
    expect(parseSite(many)!.news).toHaveLength(10);
  });
});
