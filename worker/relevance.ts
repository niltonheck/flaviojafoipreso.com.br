import topic from '../src/data/topic.json';
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
 * because a false alarm only sends the editor an email (the page keeps saying "NÃO.").
 */
export function arrestTripwire(i: Pick<FeedItem, 'title'>): boolean {
  return ARREST_PATTERNS.some((re) => {
    const m = re.exec(i.title);
    return !!m && !NEGATION.test(i.title.slice(Math.max(0, m.index - 25), m.index + m[0].length));
  });
}

const SPECULATION: RegExp[] = [
  /pris[aã]o\s+(preventiva|tempor[aá]ria|domiciliar|em\s+flagrante)/i,
  /(pedido|pedem|pede|ordem|mandado|decreta[cç][aã]o)\s+(de\s+)?pris[aã]o/i,
  /\b(base|motivo|raz[aã]o|risco|chance|possibilidade)s?\s+(para|de)\s+(a\s+)?(pris[aã]o|ser\s+preso|prend)/i,
  /\b(pode|poder[aá]|podem|deve|dever[aá]|devem|vai|va[ií]|ser[aá]|corre\s+risco\s+de|amea[cç]a\s+de)\s+(ser\s+)?(preso|presa|presos|detido)\b/i,
  /\b(cad[eê]|quando|se)\s+(ser[aá]\s+)?(preso|a\s+pris[aã]o)\b/i,
];

/**
 * Editorial rule (docs/AUTOMATION.md): the site never implies an arrest is scheduled or imminent. Headlines that
 * speculate about a future arrest ("prisão preventiva", "pode ser preso", "pedido de prisão"…) are not published
 * as news, even though they still feed the status check, which must see them.
 */
export const speculatesAboutArrest = (i: Pick<FeedItem, 'title'>): boolean => SPECULATION.some((re) => re.test(i.title));

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Headlines about the departure itself: the flight, the route, the border, the passport order that preceded it.
const DEPARTURE =
  /\bfug(a|iu|ir|indo|itivo)\b|\bexili|rota de fuga|deix\w+\s+(o\s+)?(brasil|pais)|sa(ida|iu|ir|indo|ia|isse)\s+(do|de)\s+(brasil|pais)|cruz(a|ou|am|aram)\s+(a\s+)?fronteira|\bfronteira|\b(argentina|equador|paraguai|uruguai|bolivia)\b|paradeiro|passaporte|\b(voo|jatinho|aviao|aeronave|aeroporto)\b|\basilo\b/;
// The US angle: where he is going or is, and the people who speak for or about him there.
const US =
  /\b(eua|estados unidos|washington|miami|florida|casa branca|trump|bannon|visto|vistos|departamento de estado|rubio)\b/;
// Flávio as the speaker.
const SPEAKS =
  /flavio( bolsonaro)?\s+(diz|disse|afirma|afirmou|declara|declarou|fala|falou|publica|publicou|rompe|quebra|justifica|defende|nega|grava|posta|escreve|envia|manifesta|comenta|pede|agradece|critica|acusa|reage|responde|promete|anuncia|pronuncia)|(diz|afirma|declara|escreve|publica|responde)\s+flavio|(carta|video|nota|mensagem|entrevista|discurso|pronunciamento|post|postagem)\s+de\s+flavio|flavio\s+(em|na|no)\s+(video|carta|entrevista|post|redes?)/;
// Formats that merely mention the story: roundups, podcasts, "readers comment", celebrity reactions.
const NOISE = /^resumao|resumo do dia|podcast|o assunto #|leitores comentam|neymar|richarlison|bom dia|manchetes|newsletter/;

/**
 * "Directly related" to the story the site follows (docs/AUTOMATION.md): his departure from Brazil, the US, or his own
 * statements since the story began. Everything else that merely names him (election maps, polls, party politics) is
 * not published as news, though it still feeds the arrest check.
 */
export function isOnTopic(i: Pick<FeedItem, 'title'> & { publishedAt?: string | null }): boolean {
  const t = fold(i.title);
  if (NOISE.test(t)) return false;
  if (DEPARTURE.test(t) || US.test(t)) return true;
  const since = Date.parse(topic.since);
  return SPEAKS.test(t) && !!i.publishedAt && Date.parse(i.publishedAt) >= since;
}
