export type Status = 'yes' | 'no' | 'unverified';
export type EventCategory = 'investigation' | 'court_decision' | 'defense_statement' | 'arrest_status' | 'other';
export type Source = { publisher: string; title: string; url: string; publishedAt: string };
export type TimelineEvent = {
  id: string;
  date: string;
  category: EventCategory;
  title: string;
  summary: string;
  sources: Source[];
};
export type StatusRecord = { status: Status; checkedAt: string | null; evidence: Source[] };
export type NewsItem = { id: string; title: string; source: Source };
export type Poll = { id: string; question: string; closesAt: string; yes: number; no: number; simulated: boolean };
