import { describe, expect, it } from 'vitest';
import { formatBrasilia, resolveStatus } from '../src/lib/status.ts';

const now = new Date('2026-10-27T12:00:00-03:00');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('resolveStatus', () => {
  it('keeps a fresh "no"', () => expect(resolveStatus('no', hoursAgo(2), now, 72)).toEqual({ status: 'no', reason: 'ok' }));
  it('keeps a fresh "yes"', () => expect(resolveStatus('yes', hoursAgo(71), now, 72).status).toBe('yes'));
  it('falls back when stale', () => expect(resolveStatus('no', hoursAgo(73), now, 72)).toEqual({ status: 'unverified', reason: 'stale' }));
  it('falls back without a timestamp', () => expect(resolveStatus('no', null, now, 72).reason).toBe('never-checked'));
  it('falls back on an unparsable timestamp', () => expect(resolveStatus('no', 'junk', now, 72).status).toBe('unverified'));
  it('unverified stays unverified', () => expect(resolveStatus('unverified', hoursAgo(1), now, 72).status).toBe('unverified'));
  it('honours the configured threshold', () => expect(resolveStatus('no', hoursAgo(25), now, 24).status).toBe('unverified'));
});

describe('formatBrasilia', () => {
  it('formats DD/MM/AAAA às HH:mm in São Paulo time', () => {
    expect(formatBrasilia('2026-10-27T12:00:00Z')).toBe('27/10/2026 às 09:00');
    expect(formatBrasilia('2026-10-28T02:30:00Z')).toBe('27/10/2026 às 23:30');
  });
});
