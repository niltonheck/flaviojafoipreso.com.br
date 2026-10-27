export type Choice = 'yes' | 'no';
export type PollState = 'open' | 'closed' | 'upcoming';

export type PollResults = {
  yes: number;
  no: number;
  total: number;
  state: PollState;
  /** Brasília calendar day the tally covers (null for demo data or a closed poll). */
  day: string | null;
  myVote: Choice | null;
  simulated: boolean;
};

export type PollErrorKind = 'unavailable' | 'rate_limited' | 'closed' | 'already_voted' | 'invalid';

export class PollError extends Error {
  kind: PollErrorKind;
  retryAfter?: number;
  constructor(kind: PollErrorKind, retryAfter?: number) {
    super(kind);
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

/** The UI only talks to this interface: a demo adapter locally, the Worker + D1 adapter in production. */
export interface PollRepository {
  getResults(): Promise<PollResults>;
  vote(choice: Choice): Promise<PollResults>;
}
