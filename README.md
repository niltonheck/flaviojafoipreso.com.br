# Flávio Já Foi Preso?

Site de sátira política (Astro, static, TypeScript, CSS puro). Layout escolhido: **Minimalist Hero**.
Especificações em `specs/` (A = visual, C = engenharia de produção). Status atual: **Fase 0 e PR 1 implementados**
(integridade editorial); a enquete real (PR 2) ainda não existe.

## Rodar

```bash
npm install
npm run dev            # modo demo: conteúdo fictício + enquete simulada (sem rede)
npm test               # vitest
npm run validate       # integridade do conteúdo (também roda no build)
npm run build          # PRODUÇÃO: só conteúdo real, sem mock; falha se algo for inválido
npm run build:demo     # build estático em modo demo
npm run preview
```

Modos (`--mode`): `demo` (fixtures em `src/data/fixtures/demo/`, enquete mock), `staging`, `production`.
Produção nunca carrega fixtures nem o mock da enquete: `PUBLIC_POLL_MODE=mock` em produção quebra o build, e
`scripts/check-dist.ts` confere o HTML gerado. Hoje, em produção, o Presômetro mostra "temporariamente
indisponível" até o PR 2. Fluxo editorial: [`docs/EDITORIAL.md`](docs/EDITORIAL.md).

## Estrutura

```
src/pages/index.astro        página única
src/components/              SiteHeader, StatusHero, Presometro, NewsList, SiteFooter
src/data/{status,news,poll}.json   conteúdo real (começa NÃO VERIFICADO / sem notícias)
src/data/trusted-sources.json      domínios aceitos como fonte
src/data/fixtures/demo/            conteúdo fictício (só no modo demo)
scripts/                           validate-content, editor (news:add, status:set), check-dist
tests/                             vitest
docs/EDITORIAL.md                  checklist e procedimento de correção
src/lib/                     tipos, config, status (frescor), news, validate, PollRepository (mock)
src/styles/global.css
public/images/               portrait-320.webp, portrait-480.webp
assets-src/                  fontes originais, NÃO publicadas (portrait-source.png)
_archive/timeline/           layout B arquivado (fora do build e do type-check)
```

Imagens de origem ficam em `assets-src/`, nunca em `public/`.

## Presômetro (atual)

`PollRepository` é a interface; `MockPollRepository` guarda o voto só em `sessionStorage`. O adaptador real
(Cloudflare Worker + D1) entra na Fase PR 2 da SPEC C.

## Fases (SPEC C §11)

- [x] Fase 0 — Git, limpeza, rota `/`, pipeline do retrato
- [x] PR 1 — Integridade editorial (modelos, validação, frescor do status, notícias verificadas)
- [ ] PR 2 — Enquete real local (Worker + D1)
- [ ] PR 3 — Staging Cloudflare
- [ ] PR 4 — Produção
