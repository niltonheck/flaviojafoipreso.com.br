import { ClassifierError, type Verdict } from './gemini.ts';
import { fetchFeeds, type Feed, type FeedItem, type FeedResult } from './feeds.ts';
import { arrestTripwire, isAboutFlavio, isOnTopic, speculatesAboutArrest } from './relevance.ts';
import { addNews, deleteNews, getStatus, listNews, logRun, setStatus } from './siteState.ts';
import type { D1Like } from './types.ts';

export const VERIFIED_BY = 'auto-gemini';

export type EditorialConfig = {
  minHealthyFeeds: number;   // feeds that must respond with live content
  minPublishers: number;     // ...from at least this many different outlets
  maxFeedAgeHours: number;   // a feed whose newest item is older than this is considered dead
  windowHours: number;       // how far back headlines count as "current coverage"
  minRelevantItems: number;  // headlines about Flávio needed in the window, or the check cannot run
};
export const DEFAULT_CONFIG: EditorialConfig = { minHealthyFeeds: 3, minPublishers: 2, maxFeedAgeHours: 48, windowHours: 48, minRelevantItems: 1 };

/**
 * What a run concluded. The page never changes because of it (the answer is "NÃO." unless a human records "SIM");
 * a finding only decides whether to renew the "last check" time and whether to email the editor.
 *  - ok:             a clean check, no arrest reported
 *  - arrest-signal:  something suggests an arrest, so a human must look (the job NEVER sets "SIM" itself)
 *  - cannot-verify:  the check could not run properly (feeds down, AI error...), so a human should know
 */
export type Finding =
  | { kind: 'ok' }
  | { kind: 'arrest-signal'; reason: string; evidence: { url: string; quote: string }[] }
  | { kind: 'cannot-verify'; reason: string };
export type Classify = (items: FeedItem[]) => Promise<Verdict>;

const HOUR = 3_600_000;

export async function assess(
  o: { results: FeedResult[]; relevant: FeedItem[]; now: Date; cfg: EditorialConfig; classify?: Classify },
): Promise<Finding> {
  const live = o.results.filter((r) => r.ok && r.newest && o.now.getTime() - Date.parse(r.newest) <= o.cfg.maxFeedAgeHours * HOUR);
  const publishers = new Set(live.map((r) => r.publisher));
  if (live.length < o.cfg.minHealthyFeeds || publishers.size < o.cfg.minPublishers) return { kind: 'cannot-verify', reason: 'feeds-unhealthy' };
  if (o.relevant.length < o.cfg.minRelevantItems) return { kind: 'cannot-verify', reason: 'no-recent-coverage' };

  const hits = o.relevant.filter((i) => arrestTripwire(i));
  if (hits.length > 0) return { kind: 'arrest-signal', reason: 'arrest-signal-keyword', evidence: hits.slice(0, 3).map((i) => ({ url: i.url, quote: i.title })) };

  if (!o.classify) return { kind: 'cannot-verify', reason: 'classifier-unavailable' };
  let v: Verdict;
  try {
    v = await o.classify(o.relevant);
  } catch (e) {
    return { kind: 'cannot-verify', reason: `classifier-error:${e instanceof ClassifierError ? e.message : 'unexpected'}` };
  }
  if (v.verdict === 'yes') return { kind: 'arrest-signal', reason: 'arrest-signal-ai', evidence: v.evidence };
  if (v.verdict === 'uncertain') return { kind: 'arrest-signal', reason: 'ai-uncertain', evidence: v.evidence };
  return { kind: 'ok' };
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
  'job-crashed': 'O job automático falhou inesperadamente.',
};
export const describeReason = (reason: string) =>
  REASONS[reason] ?? (reason.startsWith('classifier-error') ? `Falha no classificador (${reason.split(':')[1]}).` : reason);

/** Builds the email for a change of condition, or null when nothing worth sending changed (no repeat spam). */
export function alertFor(prevReason: string | null | undefined, reason: string, evidence: { url: string; quote: string }[]): { subject: string; body: string } | null {
  const was = prevReason ?? 'ok';
  if (reason === was) return null; // same condition as last time: do not email again
  const lines = evidence.map((e) => `- "${e.quote}"\n  ${e.url}`).join('\n');
  if (reason === 'ok') {
    return { subject: '[FJFP] Checagem automática normalizada', body: `A checagem automática voltou a funcionar normalmente (antes: ${describeReason(was)}).\nO site continua mostrando "NÃO.".` };
  }
  if (reason.startsWith('arrest-signal') || reason === 'ai-uncertain') {
    return {
      subject: '[FJFP] Possível sinal de prisão: confira',
      body: [
        `Motivo: ${describeReason(reason)}`,
        lines ? `\nTrechos citados:\n${lines}` : '',
        '\nO site continua mostrando "NÃO.". O job nunca define "SIM".',
        'Se houve prisão de fato, confirme nas fontes e rode:',
        '  npm run site:hold -- yes --env production --source <url> [--source <url>]',
      ].filter(Boolean).join('\n'),
    };
  }
  return { subject: '[FJFP] A checagem automática não conseguiu verificar', body: `Motivo: ${describeReason(reason)}\nO site continua mostrando "NÃO." (a hora da última verificação não foi renovada).` };
}

export async function runEditorial(db: D1Like, d: EditorialDeps) {
  const now = d.now();
  const cfg = d.cfg ?? DEFAULT_CONFIG;
  const prev = await getStatus(db);

  const results = await fetchFeeds(d.feeds, d.fetchFn);
  const cutoff = now.getTime() - cfg.windowHours * HOUR;
  const seen = new Set<string>();
  const all = results
    .flatMap((r) => r.items)
    .filter((i) => isAboutFlavio(i) && i.publishedAt && Date.parse(i.publishedAt) >= cutoff && !seen.has(i.url) && seen.add(i.url))
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
  // Everything that names him feeds the arrest check; only on-topic headlines are published as news.
  const relevant = all.slice(0, 25);

  // News is verbatim publisher headlines from allowlisted domains. The site follows one story (his departure from Brazil,
  // the US, his own statements), and never implies an arrest is imminent, so speculation about a future arrest is not published.
  const publishable = all.filter((i) => isOnTopic(i) && !speculatesAboutArrest(i)).slice(0, 25);
  const newNews = await addNews(db, publishable.map((i) => ({ headline: i.title, publishedAt: i.publishedAt!, publisher: i.publisher, url: i.url })), now);
  // Self-cleaning: if the topic rules change, rows stored under the old rules that no longer qualify are removed.
  const stale = (await listNews(db)).results.filter((n) => !isOnTopic({ title: n.headline, publishedAt: n.published_at }) || speculatesAboutArrest({ title: n.headline }));
  if (stale.length > 0) await deleteNews(db, stale.map((n) => n.id));
  const summary = { feedsOk: results.filter((r) => r.ok).length, feedsTotal: results.length, relevant: relevant.length, newNews, pruned: stale.length };

  // A "SIM" recorded by a human is never touched by the job.
  if (prev?.status === 'yes') {
    await logRun(db, now, 'yes-held', summary);
    return { outcome: 'yes-held' as const, ...summary };
  }

  const finding = await assess({ results, relevant, now, cfg, classify: d.classify });
  const reason = finding.kind === 'ok' ? 'ok' : finding.reason;
  // The answer stays "no". Only a clean check renews the "last check" time; otherwise the previous time is kept.
  await setStatus(
    db,
    {
      status: 'no',
      checked_at: finding.kind === 'ok' ? now.toISOString() : (prev?.checked_at ?? null),
      verified_by: VERIFIED_BY,
      mode: 'auto',
      reason,
      evidence: '[]',
    },
    now,
  );
  await logRun(db, now, finding.kind === 'ok' ? 'renewed' : `attention:${reason}`, { ...summary, reason });

  const mail = alertFor(prev ? prev.reason : null, reason, finding.kind === 'arrest-signal' ? finding.evidence : []);
  if (mail && d.alert) await d.alert(mail.subject, mail.body).catch(() => {}); // an email failure must never break the job
  return { outcome: finding.kind === 'ok' ? ('renewed' as const) : ('attention' as const), finding, ...summary };
}
