import { describe, expect, it } from 'vitest';
import { ANSWER_TEXT, answerOf, formatBrasilia } from '../src/lib/status.ts';

describe('answerOf: "NÃO." unless a human recorded "SIM" with a source', () => {
  it('is SIM only for "yes" with at least one source', () => {
    expect(answerOf('yes', 1)).toBe('yes');
    expect(answerOf('yes', 3)).toBe('yes');
  });
  it('is NÃO for "yes" without a source (never displayed)', () => expect(answerOf('yes', 0)).toBe('no'));
  it('is NÃO for "no"', () => expect(answerOf('no', 0)).toBe('no'));
  it.each(['unverified', '', 'maybe', 'YES', 'true'])('is NÃO for anything else, e.g. %j (legacy or garbage)', (s) => expect(answerOf(s, 5)).toBe('no'));
  it('has exactly two answers', () => expect(Object.keys(ANSWER_TEXT).sort()).toEqual(['no', 'yes']));
  it('never produces a "NÃO VERIFICADO" text', () => expect(JSON.stringify(ANSWER_TEXT)).not.toMatch(/VERIFICADO/));
});

describe('formatBrasilia', () => {
  it('formats DD/MM/AAAA às HH:mm in São Paulo time', () => {
    expect(formatBrasilia('2026-10-27T12:00:00Z')).toBe('27/10/2026 às 09:00');
    expect(formatBrasilia('2026-10-28T02:30:00Z')).toBe('27/10/2026 às 23:30');
  });
});
