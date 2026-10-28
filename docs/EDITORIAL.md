# Guia editorial

Site de sátira, **não é fonte oficial**. O que o site afirma de fato (status e notícias) passa por uma pessoa.
Nada é promovido automaticamente a partir de feeds de notícias ou de IA.

## Fluxo do dia a dia

```bash
# 1. Notícia: aponte para a matéria (o script lê título, veículo e data da própria página)
npm run news:add -- https://g1.globo.com/…            # use --dry-run para só visualizar
#    se faltar algo: --headline "…" --publisher "…" --date 2026-10-27 --summary "…"

# 2. Status: a resposta é NÃO até haver um SIM concreto (não há "NÃO VERIFICADO" nem expiração)
npm run status:set -- no                                      # "NÃO" (atualiza a hora da última verificação)
npm run status:set -- yes --source <url> [--source <url>]    # "SIM" exige fonte(s) confiável(is)

npm run validate && npm test      # integridade dos dados
git diff                          # revise, depois commit + PR
```

`no` só precisa da data da checagem (sem fontes); `yes` exige fontes confiáveis e nunca é automático. Os scripts só preenchem o boilerplate; **você** decide o que é verdade.

## Fontes aceitas

Só links HTTPS de domínios em `src/data/trusted-sources.json` (inclui subdomínios). O build falha para qualquer
outro. Para aceitar um veículo novo, adicione o domínio ali em um PR. Prefira fonte primária (tribunais, `jus.br`,
`gov.br`) ou mais de uma fonte independente em afirmações relevantes.

## Checklist antes de mudar o status

- [ ] Identifiquei fontes primárias ou jornalísticas confiáveis (links abertos e lidos).
- [ ] É exatamente a pessoa certa (sem homônimos).
- [ ] Distingui **prisão** de outras medidas (investigação, denúncia, busca e apreensão, restrição de viagem,
      medidas cautelares). Nenhuma delas é prisão por si só.
- [ ] Verifiquei informações conflitantes ou correções posteriores.
- [ ] `checkedAt` registra o momento da checagem (fuso de Brasília).
- [ ] A mudança foi aprovada em PR.

## Notícias

Exibimos as 3 publicadas mais recentemente. Menos de 3? Mostramos só as verificadas, nunca preenchemos com falsas.
Correção de uma notícia: adicione uma nova entrada com `correctionOf` apontando para o `id` original.

## Correção de status falso (emergência)

1. `npm run status:set -- no` (ou reverter o commit) e publicar.
2. Fazer o deploy e invalidar o cache da página (purge no Cloudflare).
3. Registrar a correção (`editorialNote` e mensagem de commit).
4. Se houver imagem de pré-visualização com status, regenerar (por padrão ela é neutra).

## Resposta padrão e SIM

A resposta é **NÃO.** a menos que um humano registre **SIM com ao menos uma fonte confiável**. Não existe "NÃO
VERIFICADO" e nada expira: uma checagem antiga só deixa a hora de "última verificação" antiga. A rotina automática
(docs/AUTOMATION.md) publica notícias e avisa por e-mail quando vê sinal de prisão ou não consegue checar, mas **nunca**
define "SIM". Para registrar um SIM no ar: `npm run site:hold -- yes --env production --source <url>`; para voltar ao NÃO:
`npm run site:auto -- --env production`.
