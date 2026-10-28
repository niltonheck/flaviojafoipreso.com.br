// RSS fixtures for the editorial tests. Dates are relative to NOW so "fresh" feeds stay fresh.
export const NOW = new Date('2026-10-28T15:00:00Z');
export const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toUTCString().replace('GMT', '+0000');

export type FeedItemSpec = { title: string; link: string; description?: string; ageHours?: number };
export const rss = (items: FeedItemSpec[], newestAgeHours = 0.5) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><pubDate>${hoursAgo(newestAgeHours)}</pubDate>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><description><![CDATA[${i.description ?? ''}]]></description><pubDate>${hoursAgo(i.ageHours ?? 1)}</pubDate></item>`)
    .join('')}</channel></rss>`;

export const FEEDS = [
  { id: 'g1-politica', url: 'https://g1.example/politica', publisher: 'G1' },
  { id: 'g1-home', url: 'https://g1.example/home', publisher: 'G1' },
  { id: 'folha-poder', url: 'https://folha.example/poder', publisher: 'Folha de S.Paulo' },
  { id: 'poder360', url: 'https://poder360.example/feed', publisher: 'Poder360' },
];

export const G1_A = 'https://g1.globo.com/politica/noticia/2026/10/28/a.ghtml';
export const FOLHA_A = 'https://www1.folha.uol.com.br/poder/2026/10/b.shtml';
export const P360_A = 'https://www.poder360.com.br/poder-eleicoes-2026/c/';

export const NORMAL = [
  { title: 'Flávio Bolsonaro não entrega passaporte à PF e descumpre ordem de Moraes', link: G1_A, description: 'Ordem do ministro Alexandre de Moraes.', ageHours: 1 },
  { title: 'Dólar fecha em alta', link: 'https://g1.globo.com/economia/d.ghtml', ageHours: 1 },
];

/** A fetch fake: url -> xml (or a status/throw). Unknown URLs are 404. */
export function fakeFetch(routes: Record<string, string | number | Error | ((init?: RequestInit) => Response)>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const r = routes[url];
    if (r === undefined) return new Response('nope', { status: 404 });
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return new Response('err', { status: r });
    if (typeof r === 'function') return r(init);
    return new Response(r, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  }) as typeof fetch;
}

export const allFeeds = (items: FeedItemSpec[]) =>
  Object.fromEntries(FEEDS.map((f) => [f.url, rss(items)])) as Record<string, string>;
