const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const dayOf = (iso: string) => String(new Date(iso).getUTCDate()).padStart(2, '0');
export const monthYear = (iso: string) => {
  const d = new Date(iso);
  return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const fmtLong = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
export const fmtInt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

export const CATEGORY_LABEL: Record<string, string> = {
  investigation: 'Investigação',
  court_decision: 'Decisão judicial',
  defense_statement: 'Posição da defesa',
  arrest_status: 'Situação prisional',
  other: 'Outros',
};

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const fmtShort = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MESES_CURTOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
