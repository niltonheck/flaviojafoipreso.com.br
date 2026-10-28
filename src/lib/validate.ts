import type { NewsItem, PollConfig, StatusRecord } from './types.ts';

export type Issue = { level: 'error' | 'warning'; path: string; message: string };
export type Options = {
  /** Demo fixtures skip evidence/URL rules but keep structural checks. */
  strict: boolean;
  trustedDomains: string[];
  now?: Date;
};

const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_ANY = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export const isValidDate = (v: unknown, requireTz = false): v is string => {
  if (typeof v !== 'string' || !(requireTz ? ISO_WITH_TZ : ISO_ANY).test(v) || Number.isNaN(Date.parse(v))) return false;
  // Date.parse rolls impossible days over (30 Feb -> 2 Mar); require the calendar date to round-trip.
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  const c = new Date(Date.UTC(y, m - 1, d));
  return c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d;
};

export function isTrustedHost(hostname: string, trusted: string[]): boolean {
  const h = hostname.toLowerCase();
  return trusted.some((d) => h === d || h.endsWith(`.${d}`));
}

function checkUrl(url: unknown, path: string, o: Options, out: Issue[]) {
  if (typeof url !== 'string' || !url) return out.push({ level: 'error', path, message: 'link ausente' });
  let u: URL;
  try { u = new URL(url); } catch { return out.push({ level: 'error', path, message: `URL inválida: ${url}` }); }
  if (u.protocol !== 'https:') return out.push({ level: 'error', path, message: `a URL precisa ser HTTPS: ${url}` });
  if (!isTrustedHost(u.hostname, o.trustedDomains)) {
    out.push({ level: 'error', path, message: `domínio fora da lista de fontes confiáveis (src/data/trusted-sources.json): ${u.hostname}` });
  }
}

export function validateStatus(r: StatusRecord, o: Options): Issue[] {
  const out: Issue[] = [];
  const now = o.now ?? new Date();
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  if (r.subject !== 'flavio-bolsonaro') err('status.subject', 'subject deve ser "flavio-bolsonaro"');
  if (!['yes', 'no'].includes(r.status)) err('status.status', 'status deve ser yes ou no');
  if (!r.verifiedBy) err('status.verifiedBy', 'verifiedBy é obrigatório');
  if (r.checkedAt !== null && !isValidDate(r.checkedAt, true)) err('status.checkedAt', 'data inválida (use ISO 8601 com fuso, ex.: 2026-10-27T09:00:00-03:00)');
  if (r.checkedAt && isValidDate(r.checkedAt, true) && Date.parse(r.checkedAt) > now.getTime() + 5 * 60_000) {
    err('status.checkedAt', 'checkedAt está no futuro');
  }
  // "no" is the default answer and needs nothing; "yes" is the only claim that must be backed by cited, trusted sources.
  if (r.status === 'yes') {
    if (!r.checkedAt) err('status.checkedAt', 'status "yes" exige checkedAt');
    if (o.strict && r.evidence.length === 0) err('status.evidence', 'status "yes" exige ao menos uma fonte');
    if (o.strict && r.evidence.length === 1) {
      out.push({ level: 'warning', path: 'status.evidence', message: 'status "yes": recomenda-se mais de uma fonte independente' });
    }
  }
  r.evidence.forEach((s, i) => {
    const p = `status.evidence[${i}]`;
    if (o.strict) checkUrl(s.url, `${p}.url`, o, out);
    if (!s.title) err(`${p}.title`, 'título ausente');
    if (!s.publisher) err(`${p}.publisher`, 'publisher ausente');
    if (!isValidDate(s.publishedAt)) err(`${p}.publishedAt`, 'data inválida');
    if (s.accessedAt !== undefined && !isValidDate(s.accessedAt)) err(`${p}.accessedAt`, 'data inválida');
  });
  return out;
}

export function validateNews(items: NewsItem[], o: Options): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  const ids = new Set<string>();
  for (const n of items) if (ids.has(n.id)) err(`news[${n.id}]`, 'id duplicado'); else ids.add(n.id);
  items.forEach((n, i) => {
    const p = `news[${n.id ?? i}]`;
    if (!n.id) err(p, 'id ausente');
    if (!n.headline) err(`${p}.headline`, 'headline ausente');
    if (!isValidDate(n.publishedAt)) err(`${p}.publishedAt`, 'data inválida');
    if (!isValidDate(n.reviewedAt, true)) err(`${p}.reviewedAt`, 'data inválida (ISO 8601 com fuso)');
    if (!n.reviewedBy) err(`${p}.reviewedBy`, 'reviewedBy é obrigatório');
    if (!n.source?.publisher) err(`${p}.source.publisher`, 'publisher ausente');
    if (o.strict) checkUrl(n.source?.url, `${p}.source.url`, o, out);
    if (n.correctionOf && !ids.has(n.correctionOf)) err(`${p}.correctionOf`, `referência inexistente: ${n.correctionOf}`);
  });
  return out;
}

export function validatePoll(p: PollConfig): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  if (!p.id) err('poll.id', 'id ausente');
  if (!p.question) err('poll.question', 'pergunta ausente');
  if (!isValidDate(p.startsAt, true)) err('poll.startsAt', 'data inválida');
  if (!isValidDate(p.closesAt, true)) err('poll.closesAt', 'data inválida');
  if (isValidDate(p.startsAt, true) && isValidDate(p.closesAt, true) && Date.parse(p.closesAt) <= Date.parse(p.startsAt)) {
    err('poll.closesAt', 'closesAt deve ser posterior a startsAt');
  }
  return out;
}
