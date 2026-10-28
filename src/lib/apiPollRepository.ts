import { PollError, type Choice, type PollRepository, type PollResults, type PollState } from './pollRepository';

type ApiPoll = {
  id: string; state: PollState; day: string | null; yes: number; no: number; total: number;
  viewerHasVoted: boolean; viewerChoice: Choice | null;
};

const STATES: PollState[] = ['open', 'closed', 'upcoming'];
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

function parse(body: unknown): ApiPoll {
  const b = body as Partial<ApiPoll> | null;
  if (!b || typeof b.id !== 'string' || !STATES.includes(b.state as PollState) || !isCount(b.yes) || !isCount(b.no) || !isCount(b.total)) {
    throw new PollError('unavailable');
  }
  return b as ApiPoll;
}

/** Talks to the same-origin Worker (`/api/*`). Counts always come from the server; nothing is invented client-side. */
export class ApiPollRepository implements PollRepository {
  private pollId: string | null;
  private base: string;
  private http: typeof fetch;
  private timeoutMs: number;
  private onSite?: (site: unknown) => void;

  constructor(opts: { pollId?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; onSite?: (site: unknown) => void } = {}) {
    this.onSite = opts.onSite;
    this.pollId = opts.pollId ?? null;
    this.base = opts.baseUrl ?? '';
    this.http = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.http(`${this.base}${path}`, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PollError('unavailable');
    }
  }

  private toResults(p: ApiPoll): PollResults {
    this.pollId = p.id;
    return { yes: p.yes, no: p.no, total: p.total, state: p.state, day: p.day, myVote: p.viewerChoice ?? null, simulated: false };
  }

  async getResults(): Promise<PollResults> {
    const res = await this.request('/api/polls/current');
    if (!res.ok) throw new PollError('unavailable');
    const body = await res.json().catch(() => null);
    const results = this.toResults(parse(body));
    // The same response may carry the automated status/news; hand it over untouched (the receiver validates it).
    if (body && typeof body === 'object' && 'site' in body) this.onSite?.((body as { site: unknown }).site);
    return results;
  }

  async vote(choice: Choice, retried = false): Promise<PollResults> {
    if (!this.pollId) await this.getResults(); // also issues the voter cookie on a first visit
    const res = await this.request(`/api/polls/${encodeURIComponent(this.pollId!)}/votes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice }),
    });
    if (res.status === 201) return this.toResults(parse(await res.json().catch(() => null)));
    const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    if (res.status === 409) throw new PollError('already_voted');
    if (res.status === 403 && (error === 'poll_closed' || error === 'poll_upcoming')) throw new PollError('closed');
    if (res.status === 429) throw new PollError('rate_limited', Number(res.headers.get('retry-after')) || 60);
    if (res.status === 400 && error === 'invalid_voter' && !retried) {
      await this.getResults(); // cookie missing/expired: fetch a fresh one, then retry exactly once
      return this.vote(choice, true);
    }
    if (res.status >= 400 && res.status < 500) throw new PollError('invalid');
    throw new PollError('unavailable');
  }
}
