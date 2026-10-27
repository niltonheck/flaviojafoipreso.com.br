const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `26 out 2026`. Date-only strings are calendar dates (UTC); timestamps use Brasília time. */
export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: DATE_ONLY.test(iso) ? 'UTC' : 'America/Sao_Paulo',
  }).format(new Date(iso)).replace(/\./g, '');

export const fmtInt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
