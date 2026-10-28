import type { ArrestStatus, StatusRecord } from './types.ts';

/**
 * An automated status is re-checked every hour, so it only stays valid for ~3 hours (two missed runs). If the job
 * dies, the page degrades to "NÃO VERIFICADO" quickly instead of leaving a stale answer up for the 72 h human window.
 */
export const AUTO_MAX_AGE_HOURS = 3;

export const ANSWER_TEXT: Record<ArrestStatus, string> = { yes: 'SIM.', no: 'NÃO.', unverified: 'NÃO VERIFICADO' };

export type StatusReason = 'ok' | 'never-checked' | 'stale' | 'unverified';
export type ResolvedStatus = { status: ArrestStatus; reason: StatusReason };

/**
 * Decide what the page may claim. `yes`/`no` need a timestamp younger than the threshold;
 * otherwise we fall back to "unverified". Pure so the build and the browser share it.
 */
export function resolveStatus(
  status: ArrestStatus,
  checkedAt: string | null,
  now: Date,
  maxAgeHours: number,
): ResolvedStatus {
  if (status === 'unverified') return { status: 'unverified', reason: 'unverified' };
  if (!checkedAt) return { status: 'unverified', reason: 'never-checked' };
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return { status: 'unverified', reason: 'never-checked' };
  const ageMs = now.getTime() - t;
  if (ageMs > maxAgeHours * 3_600_000) return { status: 'unverified', reason: 'stale' };
  return { status, reason: 'ok' };
}

export const resolveRecord = (r: StatusRecord, now: Date, maxAgeHours: number) =>
  resolveStatus(r.status, r.checkedAt, now, maxAgeHours);

/** `DD/MM/AAAA às HH:mm` in America/Sao_Paulo. */
export function formatBrasilia(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${g('day')}/${g('month')}/${g('year')} às ${g('hour')}:${g('minute')}`;
}
