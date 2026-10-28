import { describe, expect, it } from 'vitest';
import { canonicalUrl, fetchFeeds, parseFeed } from '../worker/feeds.ts';
import { arrestTripwire, isAboutFlavio, isOnTopic, speculatesAboutArrest } from '../worker/relevance.ts';
import { FEEDS, G1_A, fakeFetch, rss } from './helpers/feeds.ts';

describe('canonicalUrl', () => {
  it('unwraps Folha redirect links and keeps only trusted https URLs', () => {
    expect(canonicalUrl('https://redir.folha.com.br/redir/online/poder/rss091/*https://www1.folha.uol.com.br/poder/2026/10/x.shtml')).toBe('https://www1.folha.uol.com.br/poder/2026/10/x.shtml');
    expect(canonicalUrl('http://g1.globo.com/a.ghtml')).toBe('https://g1.globo.com/a.ghtml'); // upgraded
    expect(canonicalUrl('https://blog.example.com/a')).toBeNull(); // not on the allowlist
    expect(canonicalUrl('https://evilglobo.com/a')).toBeNull();
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
  });
  it('drops tracking parameters and fragments', () => {
    expect(canonicalUrl('https://g1.globo.com/a.ghtml?utm_source=rss&x=1#frag')).toBe('https://g1.globo.com/a.ghtml?x=1');
  });
});

describe('parseFeed', () => {
  const feed = { id: 'g1', publisher: 'G1' };
  it('reads CDATA titles, entities, dates and descriptions', () => {
    const r = parseFeed(rss([{ title: 'Flávio &amp; aliados', link: G1_A, description: '<p>Resumo <b>com</b> tags</p>', ageHours: 2 }]), feed);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ title: 'Flávio & aliados', url: G1_A, publisher: 'G1', description: 'Resumo com tags' });
    expect(Date.parse(r.items[0].publishedAt!)).toBeGreaterThan(0);
    expect(r.newest).not.toBeNull();
  });
  it('skips items with an untrusted or missing link, or no title', () => {
    const r = parseFeed(rss([{ title: 'ok', link: G1_A }, { title: 'bad host', link: 'https://spam.example/x' }, { title: '', link: G1_A }]), feed);
    expect(r.items.map((i) => i.title)).toEqual(['ok']);
  });
  it('tolerates garbage without throwing', () => expect(parseFeed('<rss><channel><item><title>x', feed).items).toEqual([]));
});

describe('fetchFeeds', () => {
  it('marks failing, non-XML and throwing feeds as not ok and keeps the good ones', async () => {
    const f = fakeFetch({
      [FEEDS[0].url]: rss([{ title: 'Flávio Bolsonaro x', link: G1_A }]),
      [FEEDS[1].url]: 500,
      [FEEDS[2].url]: '<html>blocked by bot protection</html>',
      [FEEDS[3].url]: new Error('timeout'),
    });
    const r = await fetchFeeds(FEEDS, f);
    expect(r.map((x) => x.ok)).toEqual([true, false, false, false]);
    expect(r[0].items).toHaveLength(1);
    expect(r[1].publisher).toBe('G1');
  });
});

describe('isAboutFlavio', () => {
  it.each([
    ['Flávio Bolsonaro não entrega passaporte', '', true],
    ['Aliados de Flávio avisados de saída', 'o senador Flávio Bolsonaro (PL)', true],
    ['Aliados de Flávio avisados de saída', 'texto sem relação', false],
    ['Flávio Dino manda PF investigar empresa', 'ministro do STF', false],
    ['Dino manda PF investigar financiamento à campanha de Flávio Bolsonaro', '', true],
    ['Dólar fecha em alta', 'Bolsonaro citado', false],
  ])('%s -> %s', (title, description, expected) => expect(isAboutFlavio({ title, description })).toBe(expected));
});

describe('arrestTripwire', () => {
  it.each([
    'Flávio Bolsonaro é preso pela PF',
    'Flávio foi preso em Brasília',
    'PF prende Flávio Bolsonaro',
    'Prisão de Flávio Bolsonaro é decretada por Moraes',
    'Flávio Bolsonaro preso: o que se sabe',
    'Flávio Bolsonaro foi levado para a delegacia da PF',
  ])('fires on: %s', (title) => expect(arrestTripwire({ title })).toBe(true));
  it.each([
    'Flávio Bolsonaro não foi preso, diz PF',
    'Por que Flávio ainda não foi preso',
    'Moraes manda Flávio entregar passaporte e o proíbe de deixar o país',
    'PF apura se Flávio Bolsonaro deixou o Brasil pela fronteira',
    'Aliados de Flávio dizem que ele não está preso',
    'Prisão de aliado de Flávio é decretada',
  ])('stays quiet on: %s', (title) => expect(arrestTripwire({ title })).toBe(false));
});

describe('speculatesAboutArrest (never imply an imminent arrest)', () => {
  it.each([
    'Fuga do Brasil dá base para prisão preventiva de Flávio Bolsonaro, dizem especialistas',
    'PGR pede prisão de Flávio Bolsonaro',
    'Flávio Bolsonaro pode ser preso se não entregar passaporte',
    'Moraes avalia mandado de prisão contra Flávio',
    'Flávio corre risco de ser preso, diz advogado',
    'Cadê Flávio? Quando será preso?',
  ])('blocks: %s', (title) => expect(speculatesAboutArrest({ title })).toBe(true));
  it.each([
    'Flávio Bolsonaro chega aos EUA, diz BBC',
    'Moraes manda Flávio entregar passaporte e o proíbe de deixar o país',
    'PF apura se Flávio Bolsonaro deixou o Brasil pela fronteira com a Argentina',
    '“Não é fuga, mas exílio”, dizem bolsonaristas sobre Flávio sair do país',
    'Leia a cronologia dos fatos que levaram Flávio a deixar o Brasil',
  ])('allows: %s', (title) => expect(speculatesAboutArrest({ title })).toBe(false));
});

describe('isOnTopic (the story the site follows: his departure, the US, his own statements)', () => {
  const after = '2026-10-28T10:00:00.000Z';
  it.each([
    'Avião com Flávio Bolsonaro e família segue para Miami',
    'Argentina confirma que Flávio Bolsonaro cruzou fronteira pelo Paraná com a família',
    '“Por mim, tudo bem”, diz Trump sobre Flávio Bolsonaro nos EUA',
    'Flávio Bolsonaro chega aos EUA, diz BBC',
    '“Não é fuga, mas exílio”, dizem bolsonaristas sobre Flávio sair do país',
    'Leia a cronologia dos fatos que levaram Flávio a deixar o Brasil',
    'Coordenador de campanha se diz surpreso com fuga de Flávio',
    'Flávio Bolsonaro não entrega passaporte à PF e descumpre ordem de Moraes',
    'Oposição na Argentina pede informações sobre entrada de Flávio no país',
    'Trump diz que aprovaria visto de Flávio, mas que não sabe o paradeiro do senador',
  ])('publishes: %s', (title) => expect(isOnTopic({ title, publishedAt: after })).toBe(true));

  it.each([
    'Dominado por Flávio Bolsonaro, apenas 10 cidades do Centro-Oeste de MG deram vitória a Lula',
    'Lula ganhou mais votos do que Flávio Bolsonaro nas 20 cidades com maior queda de abstenção no 2º turno',
    'Aliados de Flávio Bolsonaro adiam mea-culpa e atribuem derrota a pacote de Lula',
    'Resumão diário #2207: Voo de Flávio Bolsonaro e família deixa Equador com destino a Miami',
    'Neymar reage a post de Richarlison que ironizou fuga de Flávio Bolsonaro',
    'Podcast discute reações e impactos iniciais da fuga de Flávio Bolsonaro',
    'O Assunto #1834: a rota de fuga de Flávio Bolsonaro',
  ])('does not publish: %s', (title) => expect(isOnTopic({ title, publishedAt: after })).toBe(false));

  it('counts his OWN statements, but only from the date the story began', () => {
    const title = 'Flávio Bolsonaro diz que vai liderar a oposição';
    expect(isOnTopic({ title, publishedAt: '2026-10-28T10:00:00.000Z' })).toBe(true);
    expect(isOnTopic({ title, publishedAt: '2026-10-26T10:00:00.000Z' })).toBe(false); // an election-night statement
    expect(isOnTopic({ title })).toBe(false); // no date, no statement
    expect(isOnTopic({ title: 'Flávio Bolsonaro publica vídeo', publishedAt: after })).toBe(true);
    expect(isOnTopic({ title: 'Carta de Flávio Bolsonaro aos apoiadores', publishedAt: after })).toBe(true);
  });
});
