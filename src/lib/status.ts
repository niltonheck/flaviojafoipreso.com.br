import type { ArrestStatus } from './types.ts';

export const ANSWER_TEXT: Record<ArrestStatus, string> = { yes: 'SIM.', no: 'NÃO.' };

/**
 * The only rule for what the page claims: "NÃO." always, unless a human has recorded "yes" AND attached at least one
 * source. A "yes" without a source is ignored (shown as "NÃO."). Anything else, including legacy values, is "NÃO.".
 */
export function answerOf(status: string, evidenceCount: number): ArrestStatus {
  return status === 'yes' && evidenceCount > 0 ? 'yes' : 'no';
}

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
