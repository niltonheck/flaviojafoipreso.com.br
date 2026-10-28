import type { ArrestStatus } from './types';

/** Automated status + newest headlines served by the Worker (docs/AUTOMATION.md). */
export type SiteEvidence = { publisher: string; title?: string; url: string };
export type SiteStatus = { status: ArrestStatus; checkedAt: string | null; verifiedBy: string; mode: 'auto' | 'manual'; evidence: SiteEvidence[] };
export type SiteNews = { headline: string; publishedAt: string; publisher: string; url: string };
export type SiteData = { status: SiteStatus; news: SiteNews[] };

export const SITE_EVENT = 'fjfp:site';

const str = (v: unknown, max = 400): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const https = (v: unknown): v is string => {
  if (!str(v, 600)) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
};
const iso = (v: unknown): v is string => str(v, 40) && !Number.isNaN(Date.parse(v));

/** Validates untrusted JSON before it touches the DOM. Returns null for anything unexpected (the page then keeps its snapshot). */
export function parseSite(raw: unknown): SiteData | null {
  const r = raw as { status?: Record<string, unknown>; news?: unknown } | null;
  const s = r?.status;
  if (!s || typeof s !== 'object' || !['yes', 'no', 'unverified'].includes(s.status as string)) return null;
  if (s.mode !== 'auto' && s.mode !== 'manual') return null;
  if (!(s.checkedAt === null || iso(s.checkedAt)) || !str(s.verifiedBy, 80)) return null;
  const evidenceRaw = Array.isArray(s.evidence) ? s.evidence.slice(0, 10) : null;
  if (!evidenceRaw) return null;
  const evidence: SiteEvidence[] = [];
  for (const e of evidenceRaw as Record<string, unknown>[]) {
    if (!e || !str(e.publisher, 80) || !https(e.url)) return null;
    evidence.push({ publisher: e.publisher, url: e.url, ...(str(e.title) ? { title: e.title } : {}) });
  }
  if (s.status === 'yes' && evidence.length === 0) return null; // "yes" without a source is never displayed
  const news: SiteNews[] = [];
  for (const n of (Array.isArray(r?.news) ? r!.news.slice(0, 10) : []) as Record<string, unknown>[]) {
    if (!n || !str(n.headline, 300) || !iso(n.publishedAt) || !str(n.publisher, 80) || !https(n.url)) return null;
    news.push({ headline: n.headline, publishedAt: n.publishedAt, publisher: n.publisher, url: n.url });
  }
  return { status: { status: s.status as ArrestStatus, checkedAt: s.checkedAt as string | null, verifiedBy: s.verifiedBy as string, mode: s.mode, evidence }, news };
}
