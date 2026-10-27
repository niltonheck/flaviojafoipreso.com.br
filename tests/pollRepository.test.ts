import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiPollRepository } from '../src/lib/apiPollRepository.ts';
import { MockPollRepository } from '../src/lib/mockPollRepository.ts';
import { PollError } from '../src/lib/pollRepository.ts';

const poll = (o: object = {}) => ({ id: 'p1', state: 'open', day: '2026-10-27', yes: 3, no: 1, total: 4, viewerHasVoted: false, viewerChoice: null, ...o });
const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const kind = async (p: Promise<unknown>) => p.then(() => 'no error', (e) => (e as PollError).kind);

describe('MockPollRepository', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  const seed = { id: 'd', yes: 68, no: 32 };

  it('starts from the seed and is flagged as simulated', async () => {
    expect(await new MockPollRepository(seed).getResults()).toMatchObject({ yes: 68, no: 32, total: 100, simulated: true, myVote: null });
  });
  it('registers one vote, then behaves like the API and refuses a second', async () => {
    const repo = new MockPollRepository(seed);
    expect(await repo.vote('yes')).toMatchObject({ yes: 69, total: 101, myVote: 'yes' });
    expect(await kind(repo.vote('no'))).toBe('already_voted');
    expect(await new MockPollRepository(seed).getResults()).toMatchObject({ myVote: 'yes' });
  });
});

describe('ApiPollRepository', () => {
  it('maps the API response to results (never simulated)', async () => {
    const repo = new ApiPollRepository({ fetchImpl: async () => res(200, poll({ viewerHasVoted: true, viewerChoice: 'yes' })) });
    expect(await repo.getResults()).toEqual({ yes: 3, no: 1, total: 4, state: 'open', day: '2026-10-27', myVote: 'yes', simulated: false });
  });

  it('sends a same-origin JSON POST to the poll id learned from the server', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, poll())).mockResolvedValueOnce(res(201, poll({ yes: 4, viewerChoice: 'yes' })));
    const repo = new ApiPollRepository({ fetchImpl: f });
    expect(await repo.vote('yes')).toMatchObject({ yes: 4, myVote: 'yes' });
    const [url, init] = f.mock.calls[1];
    expect(url).toBe('/api/polls/p1/votes');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"choice":"yes"}' });
  });

  it.each([
    [409, { error: 'already_voted' }, 'already_voted'],
    [403, { error: 'poll_closed' }, 'closed'],
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [400, { error: 'invalid_body' }, 'invalid'],
    [503, { error: 'unavailable' }, 'unavailable'],
    [500, 'boom', 'unavailable'],
  ])('maps vote status %i to %s', async (status, body, expected) => {
    const repo = new ApiPollRepository({ pollId: 'p1', fetchImpl: async () => res(status, body, status === 429 ? { 'retry-after': '30' } : {}) });
    expect(await kind(repo.vote('yes'))).toBe(expected);
  });

  it('carries Retry-After on rate limiting', async () => {
    const repo = new ApiPollRepository({ pollId: 'p1', fetchImpl: async () => res(429, { error: 'rate_limited' }, { 'retry-after': '30' }) });
    await expect(repo.vote('yes')).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 30 });
  });

  it('treats network failures and malformed payloads as unavailable, never as fake data', async () => {
    expect(await kind(new ApiPollRepository({ fetchImpl: async () => { throw new TypeError('offline'); } }).getResults())).toBe('unavailable');
    expect(await kind(new ApiPollRepository({ fetchImpl: async () => res(200, { id: 'x', yes: -1 }) }).getResults())).toBe('unavailable');
    expect(await kind(new ApiPollRepository({ fetchImpl: async () => res(200, 'not json') }).getResults())).toBe('unavailable');
    expect(await kind(new ApiPollRepository({ fetchImpl: async () => res(503, { error: 'unavailable' }) }).getResults())).toBe('unavailable');
  });

  it('re-fetches a missing voter cookie and retries the vote exactly once', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(400, { error: 'invalid_voter' }))
      .mockResolvedValueOnce(res(200, poll()))
      .mockResolvedValueOnce(res(201, poll({ yes: 4, viewerChoice: 'yes' })));
    expect(await new ApiPollRepository({ pollId: 'p1', fetchImpl: f }).vote('yes')).toMatchObject({ yes: 4 });
    const g = vi.fn().mockResolvedValue(res(400, { error: 'invalid_voter' }));
    g.mockResolvedValueOnce(res(400, { error: 'invalid_voter' })).mockResolvedValueOnce(res(200, poll()));
    expect(await kind(new ApiPollRepository({ pollId: 'p1', fetchImpl: g }).vote('yes'))).toBe('invalid');
    expect(g).toHaveBeenCalledTimes(3);
  });
});
