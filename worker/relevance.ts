import type { FeedItem } from './feeds.ts';

const FLAVIO_FULL = /Fl[aá]vio\s+Bolsonaro/i;
const FLAVIO = /\bFl[aá]vio\b/i;

/** Headline is mainly about Flávio Bolsonaro (not Flávio Dino or a passing mention in the description). */
export function isAboutFlavio(i: Pick<FeedItem, 'title' | 'description'>): boolean {
  if (FLAVIO_FULL.test(i.title)) return true;
  if (!FLAVIO.test(i.title) || /Fl[aá]vio\s+Dino/i.test(i.title)) return false;
  return /Bolsonaro/i.test(`${i.title} ${i.description}`); // bare "Flávio" in a headline needs Bolsonaro context
}

const NEGATION = /\b(n[ãa]o|nunca|jamais|ainda n[ãa]o|sem)\b/i;
const ARREST_PATTERNS: RegExp[] = [
  /Fl[aá]vio(?:\s+Bolsonaro)?\s+(?:é|foi|fica|está|esta|segue|permanece)\s+(?:preso|detido)\b/i,
  /Fl[aá]vio(?:\s+Bolsonaro)?\s+(?:é|foi)\s+levado\s+(?:para|à|a)\s+(?:a\s+)?(?:pris[aã]o|cadeia|delegacia|pol[ií]cia)/i,
  /\b(?:prendem|prende|prenderam|prendeu)\s+(?:o\s+senador\s+)?Fl[aá]vio/i,
  /pris[aã]o\s+de\s+Fl[aá]vio(?:\s+Bolsonaro)?\s+(?:é\s+|foi\s+)?(?:decretada|efetivada|cumprida)/i,
  /\bFl[aá]vio(?:\s+Bolsonaro)?\s+preso\b/i,
];

/**
 * Deterministic safety net that runs without any AI: positive arrest phrasing about Flávio in a headline.
 * It is intentionally conservative on negation ("não foi preso" never matches) but loud otherwise,
 * because a false alarm only drops the site to "NÃO VERIFICADO".
 */
export function arrestTripwire(i: Pick<FeedItem, 'title'>): boolean {
  return ARREST_PATTERNS.some((re) => {
    const m = re.exec(i.title);
    return !!m && !NEGATION.test(i.title.slice(Math.max(0, m.index - 25), m.index + m[0].length));
  });
}
