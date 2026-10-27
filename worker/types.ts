// Minimal structural types so the API logic is testable without the Workers runtime.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  /** Runs the statements in order inside one transaction (D1 guarantees all-or-nothing). */
  batch(statements: D1Statement[]): Promise<unknown[]>;
}
export interface RateLimiter { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  DB: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Worker secret (>= 32 chars). Never exposed to the browser. */
  VOTER_HMAC_SECRET?: string;
  /** Extra allowed Origins for POST, comma separated. Same-origin is always allowed. */
  ALLOWED_ORIGINS?: string;
  VOTE_LIMITER?: RateLimiter;
}

export type Choice = 'yes' | 'no';
export type PollState = 'open' | 'closed' | 'upcoming';
