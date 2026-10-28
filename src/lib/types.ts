/** The answer is "no" unless a human has confirmed an arrest with sources. There is no third state. */
export type ArrestStatus = 'yes' | 'no';

export type Source = {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string; // ISO 8601
  accessedAt?: string;
};

export type StatusRecord = {
  subject: 'flavio-bolsonaro';
  status: ArrestStatus;
  checkedAt: string | null; // ISO 8601 with timezone
  verifiedBy: string; // editor identifier, not necessarily public
  evidence: Source[];
  editorialNote?: string;
};

export type NewsItem = {
  id: string;
  headline: string;
  summary?: string;
  publishedAt: string; // ISO 8601
  source: { publisher: string; url: string };
  reviewedAt: string; // ISO 8601
  reviewedBy: string;
  correctionOf?: string;
};

export type PollConfig = { id: string; question: string; startsAt: string; closesAt: string };
export type DemoCounts = { yes: number; no: number };

export type SiteMode = 'demo' | 'staging' | 'production';
export type PollMode = 'mock' | 'api';
