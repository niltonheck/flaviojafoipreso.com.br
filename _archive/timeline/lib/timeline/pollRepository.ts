import type { Poll } from './types';

export type Choice = 'yes' | 'no';
export type PollResults = { yes: number; no: number; simulated: boolean; myVote: Choice | null };

/** UI talks only to this interface; a Cloudflare Worker + D1 adapter can replace the mock later. */
export interface PollRepository {
  getResults(): Promise<PollResults>;
  vote(choice: Choice): Promise<PollResults>;
}

/** Browser-only demo adapter. Nothing leaves the page; the vote lives in sessionStorage. */
export class MockPollRepository implements PollRepository {
  private key: string;
  constructor(private seed: Pick<Poll, 'id' | 'yes' | 'no'>) {
    this.key = `timeline-poll:${seed.id}:vote`;
  }
  private read(): Choice | null {
    try {
      const v = sessionStorage.getItem(this.key);
      return v === 'yes' || v === 'no' ? v : null;
    } catch {
      return null;
    }
  }
  async getResults(): Promise<PollResults> {
    const myVote = this.read();
    return {
      yes: this.seed.yes + (myVote === 'yes' ? 1 : 0),
      no: this.seed.no + (myVote === 'no' ? 1 : 0),
      simulated: true,
      myVote,
    };
  }
  async vote(choice: Choice): Promise<PollResults> {
    try {
      sessionStorage.setItem(this.key, choice);
    } catch {
      /* storage blocked: the UI still updates for this view */
    }
    const r = await this.getResults();
    return r.myVote === choice ? r : {
      yes: this.seed.yes + (choice === 'yes' ? 1 : 0),
      no: this.seed.no + (choice === 'no' ? 1 : 0),
      simulated: true,
      myVote: choice,
    };
  }
}
