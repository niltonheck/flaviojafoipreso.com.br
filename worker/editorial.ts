import { ClassifierError, type Verdict } from './gemini.ts';
import { fetchFeeds, type Feed, type FeedItem, type FeedResult } from './feeds.ts';
import { arrestTripwire, isAboutFlavio, speculatesAboutArrest } from './relevance.ts';
import { addNews, getStatus, logRun, setStatus } from './siteState.ts';
import type { D1Like } from './types.ts';

export const VERIFIED_BY = 'auto-gemini';

export type EditorialConfig = {
  minHealthyFeeds: number;   // feeds that must respond with live content
  minPublishers: number;     // ...from at least this many different outlets
  maxFeedAgeHours: number;   // a feed whose newest item is older than this is considered dead
  windowHours: number;       // how far back headlines count as "current coverage"
  minRelevantItems: number;  // headlines about Flávio needed in the window, or we cannot verify
};
export const DEFAULT_CONFIG: EditorialConfig = { minHealthyFeeds: 3, minPublishers: 2, maxFeedAgeHours: 48, windowHours: 48, minRelevantItems: 1 };

export type Decision = { status: 'no' | 'unverified'; reason: string; evidence: { url: string; quote: string }[] };
export type Classify = (items: FeedItem[]) => Promise<Verdict>;

const HOUR = 3_600_000;

/**
 * The only place the status is decided. It can only ever return "no" or "unverified": there is deliberately no
 * path to "yes" (a human must confirm that, with sources), and every doubt resolves to "unverified".
 */
export async function decide(
  o: { results: FeedResult[]; relevant: FeedItem[]; now: Date; cfg: EditorialConfig; classify?: Classify },
): Promise<Decision> {
  const live = o.results.filter((r) => r.ok && r.newest && o.now.getTime() - Date.parse(r.newest) <= o.cfg.maxFeedAgeHours * HOUR);
  const publishers = new Set(live.map((r) => r.publisher));
  if (live.length < o.cfg.minHealthyFeeds || publishers.size < o.cfg.minPublishers) return { status: 'unverified', reason: 'feeds-unhealthy', evidence: [] };
  if (o.relevant.length < o.cfg.minRelevantItems) return { status: 'unverified', reason: 'no-recent-coverage', evidence: [] };

  const hits = o.relevant.filter((i) => arrestTripwire(i));
  if (hits.length > 0) return { status: 'unverified', reason: 'arrest-signal-keyword', evidence: hits.slice(0, 3).map((i) => ({ url: i.url, quote: i.title })) };

  if (!o.classify) return { status: 'unverified', reason: 'classifier-unavailable', evidence: [] };
  let v: Verdict;
  try {
    v = await o.classify(o.relevant);
  } catch (e) {
    return { status: 'unverified', reason: `classifier-error:${e instanceof ClassifierError ? e.message : 'unexpected'}`, evidence: [] };
  }
  if (v.verdict === 'yes') return { status: 'unverified', reason: 'arrest-signal-ai', evidence: v.evidence };
  if (v.verdict === 'uncertain') return { status: 'unverified', reason: 'ai-uncertain', evidence: v.evidence };
  return { status: 'no', reason: 'ok', evidence: [] };
}

export type EditorialDeps = {
  now: () => Date;
  fetchFn: typeof fetch;
  feeds: Feed[];
  cfg?: EditorialConfig;
  classify?: Classify;
  alert?: (subject: string, body: string) => Promise<void>;
};

const REASONS: Record<string, string> = {
  'feeds-unhealthy': 'Não foi possível ler feeds suficientes (ou estão desatualizados).',
  'no-recent-coverage': 'Nenhuma manchete recente sobre ele nos feeds.',
  'arrest-signal-keyword': 'Uma manchete contém formulação de prisão (detecção por palavras).',
  'arrest-signal-ai': 'A IA entendeu que algum item informa prisão efetivada.',
  'ai-uncertain': 'A IA não tem certeza se houve prisão.',
  'classifier-unavailable': 'Classificador (Gemini) não configurado.',
};
const describe = (reason: string) => REASONS[reason] ?? (reason.startsWith('classifier-error') ? `Falha no classificador (${reason.split(':')[1]}).` : reason);

export async function runEditorial(db: D1Like, d: EditorialDeps) {
  const now = d.now();
  const cfg = d.cfg ?? DEFAULT_CONFIG;
  const prev = await getStatus(db);

  const results = await fetchFeeds(d.feeds, d.fetchFn);
  const cutoff = now.getTime() - cfg.windowHours * HOUR;
  const seen = new Set<string>();
  const relevant = results
    .flatMap((r) => r.items)
    .filter((i) => isAboutFlavio(i) && i.publishedAt && Date.parse(i.publishedAt) >= cutoff && !seen.has(i.url) && seen.add(i.url))
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))
    .slice(0, 25);

  // News is verbatim publisher headlines from allowlisted domains, so it publishes even when the status check is degraded.
  const publishable = relevant.filter((i) => !speculatesAboutArrest(i));
  const newNews = await addNews(db, publishable.map((i) => ({ headline: i.title, publishedAt: i.publishedAt!, publisher: i.publisher, url: i.url })), now);

  const summary = { feedsOk: results.filter((r) => r.ok).length, feedsTotal: results.length, relevant: relevant.length, newNews };

  if (prev?.mode === 'manual') {
    await logRun(db, now, 'manual-hold', { ...summary, held: prev.status });
    return { outcome: 'manual-hold' as const, ...summary };
  }

  const decision = await decide({ results, relevant, now, cfg, classify: d.classify });
  await setStatus(
    db,
    {
      status: decision.status,
      checked_at: decision.status === 'no' ? now.toISOString() : null,
      verified_by: VERIFIED_BY,
      mode: 'auto',
      reason: decision.reason,
      evidence: '[]', // an automatic "no" needs none; "yes" is never automatic
    },
    now,
  );
  await logRun(db, now, decision.status === 'no' ? 'renewed' : `unverified:${decision.reason}`, { ...summary, reason: decision.reason });

  const changed = prev ? prev.status !== decision.status : decision.status !== 'no';
  if (changed && d.alert) {
    const lines = decision.evidence.map((e) => `- "${e.quote}"\n  ${e.url}`).join('\n');
    const subject = decision.status === 'unverified' ? '[FJFP] Status caiu para NÃO VERIFICADO' : '[FJFP] Status voltou a NÃO.';
    const body = [
      decision.status === 'unverified' ? 'O site agora mostra "NÃO VERIFICADO".' : 'O site voltou a mostrar "NÃO.".',
      `Motivo: ${describe(decision.reason)}`,
      lines ? `\nTrechos citados:\n${lines}` : '',
      `\nFeeds lidos: ${summary.feedsOk}/${summary.feedsTotal}. Manchetes sobre ele: ${summary.relevant}.`,
      decision.reason.startsWith('arrest-signal') ? '\nSe houve prisão de fato, confirme nas fontes e defina o status "SIM" manualmente (com fontes). O job nunca define "SIM".' : '',
    ].filter(Boolean).join('\n');
    await d.alert(subject, body).catch(() => {}); // an email failure must never break the job
  }
  return { outcome: decision.status === 'no' ? ('renewed' as const) : ('unverified' as const), decision, ...summary };
}
