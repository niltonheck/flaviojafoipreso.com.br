# Flávio Já Foi Preso?

Site de sátira política (Astro, static, TypeScript, CSS puro). Layout escolhido: **Minimalist Hero**.
Especificações em `specs/` (A = visual, C = engenharia de produção). Status atual: **Fase 0, PR 1, PR 2 e PR 3**
(código pronto para staging; nada foi publicado ainda). Produção é o PR 4.

## Rodar

```bash
npm install
npm run dev            # modo demo: conteúdo fictício + enquete simulada (sem rede)
npm test               # vitest
npm run validate       # integridade do conteúdo (também roda no build)
npm run build:staging  # staging (noindex, banner de teste)
npm run build          # PRODUÇÃO: só conteúdo real, sem mock; falha se algo for inválido
npm run build:demo     # build estático em modo demo
npm run preview
```

Modos (`--mode`): `demo` (fixtures em `src/data/fixtures/demo/`, enquete mock), `staging`, `production`.
Produção nunca carrega fixtures nem o mock da enquete: `PUBLIC_POLL_MODE=mock` em produção quebra o build, e
`scripts/check-dist.ts` confere o HTML gerado. Em produção o Presômetro usa a API real; se ela falhar, mostra "temporariamente indisponível". Fluxo editorial: [`docs/EDITORIAL.md`](docs/EDITORIAL.md).

## Antes de publicar em produção

- `src/data/site.json`: preencha `operatorName` e `contactEmail` (política de privacidade em `/privacidade`).
  `npm run build` (produção) **falha** enquanto houver `[PREENCHER]` no site.
- O texto da política é um rascunho e precisa de revisão jurídica.
- A regra de retenção (votos + 90 dias, depois só totais) ainda não tem o job que a executa (PR 4).

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
docs/API.md · docs/DEPLOY.md       contrato da enquete · deploy, rollback e monitoramento
src/lib/                     tipos, config, status (frescor), news, validate, PollRepository (mock + API)
worker/                      Cloudflare Worker (API /api/*), migrations/, seeds/, wrangler.jsonc
.github/workflows/           ci.yml (PRs) e deploy-staging.yml (manual)
src/styles/global.css
public/images/               portrait-320.webp, portrait-480.webp
assets-src/                  fontes originais, NÃO publicadas (portrait-source.png)
_archive/timeline/           layout B arquivado (fora do build e do type-check)
```

Imagens de origem ficam em `assets-src/`, nunca em `public/`.

## Presômetro (atual)

`PollRepository` é a interface. Demo: `MockPollRepository` (só `sessionStorage`, nunca vai para o build de
produção). Real: `ApiPollRepository` → Worker + D1, **um voto por dia por navegador**. Contrato, segurança e
como rodar localmente: [`docs/API.md`](docs/API.md).

## Fases (SPEC C §11)

- [x] Fase 0 — Git, limpeza, rota `/`, pipeline do retrato
- [x] PR 1 — Integridade editorial (modelos, validação, frescor do status, notícias verificadas)
- [x] PR 2 — Enquete real local (Worker + D1, voto diário)
- [x] PR 3 — Staging Cloudflare (config, headers/CSP, guardas, CI, docs; falta só você criar os recursos: `docs/DEPLOY.md`)
- [ ] PR 4 — Produção
