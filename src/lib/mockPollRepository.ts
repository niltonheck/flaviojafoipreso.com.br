import { PollError, type Choice, type PollRepository, type PollResults } from './pollRepository';

/** Browser-only demo adapter (demo/local builds only). Nothing leaves the page; the vote lives in sessionStorage. */
export class MockPollRepository implements PollRepository {
  private key: string;
  private seed: { id: string; yes: number; no: number };

  constructor(seed: { id: string; yes: number; no: number }) {
    this.seed = seed;
    this.key = `fjfp-demo:${seed.id}:vote`;
  }

  private read(): Choice | null {
    try {
      const v = sessionStorage.getItem(this.key);
      return v === 'yes' || v === 'no' ? v : null;
    } catch {
      return null;
    }
  }

  private results(myVote: Choice | null): PollResults {
    const yes = this.seed.yes + (myVote === 'yes' ? 1 : 0);
    const no = this.seed.no + (myVote === 'no' ? 1 : 0);
    return { yes, no, total: yes + no, state: 'open', day: null, myVote, simulated: true };
  }

  async getResults() {
    return this.results(this.read());
  }

  async vote(choice: Choice) {
    // Same rule as the real API: one vote, no switching.
    if (this.read()) throw new PollError('already_voted');
    try {
      sessionStorage.setItem(this.key, choice);
    } catch {
      /* storage blocked: the UI still updates for this view */
    }
    return this.results(choice);
  }
}
