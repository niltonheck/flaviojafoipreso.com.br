# Deploy (Cloudflare) — staging now, production in PR 4

Nothing here costs money by itself, but **verify current free-tier limits and pricing at deploy time**: this
repo does not hardcode any quota (SPEC C §7). Nothing is deployed until you run these steps.

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| Content | demo fixtures | real files (starts "NÃO VERIFICADO", no news) | real files |
| Poll | mock **or** local D1 | Worker + its own D1, fake poll id `staging-…` | Worker + its own D1 |
| URL | localhost | `*.workers.dev`, noindex, banner "Ambiente de teste" | custom domain (PR 4) |
| Build | `npm run dev` | `npm run build:staging` | `npm run build` |

Staging and production never share a database or a secret. The mock poll is refused in production builds.

## Staging status

Deployed 2026-10-27: Worker `flaviojafoipreso-staging` (workers.dev), D1 `fjfp-staging`, secret
`VOTER_HMAC_SECRET` set, rate limiter bound. Verified live: all 12 smoke checks, a real browser vote that persists
across reloads, CSP with zero violations, duplicate vote → 409. **Rate limiter:** it does trigger (200 rapid requests
→ 54 were 429), but it is approximate: 25 sequential requests were not limited. Treat it as an abuse brake; the
database unique constraint is what guarantees one vote per day. Free-tier quotas and pricing were **not** verified.
The account and the exact staging URL are intentionally not recorded in this repo; keep them in your notes (and in
the GitHub `STAGING_URL` variable if you use the deploy workflow).

## One-time staging setup

```bash
# 0. Log in (opens a browser). In Claude Code, type it with the "!" prefix.
npx wrangler login

# 1. Create the staging database and paste its id into wrangler.jsonc (env.staging.d1_databases[0].database_id).
#    The id is not secret; commit it.
npx wrangler d1 create fjfp-staging

# 2. Schema + fake poll (remote = the real staging DB)
npm run db:migrate:staging
npm run db:seed:staging

# 3. Secret (>= 32 random chars). It lives only in Cloudflare; never in git or a PUBLIC_ variable.
openssl rand -hex 32          # copy the output, then:
npx wrangler secret put VOTER_HMAC_SECRET --env staging

# 4. Deploy (refuses to run while an id is still a placeholder), then smoke-test the printed URL
npm run deploy:staging
npm run health:staging -- https://flaviojafoipreso-staging.<your-subdomain>.workers.dev
```

Also set `ALLOWED_ORIGINS` only if the site is reached from an origin other than its own (same-origin is always
allowed). Rate limiting uses the `VOTE_LIMITER` binding (20 votes / 60 s per hashed IP and per voter cookie);
confirm the feature's availability and limits on your plan, and consider a Cloudflare WAF rate-limiting rule in
front of `/api/*` as a second layer.

### What the smoke test checks
`/api/health`, poll shape and no-store, hardened cookie, staging poll id, page in pt-BR, CSP/HSTS/nosniff, noindex
outside production, and that a cross-origin vote is refused. It never casts a vote.

### GitHub Actions (optional)
`ci.yml` runs on every PR (tests, production + staging builds, leak checks). `deploy-staging.yml` is manual-only:
create a GitHub environment `staging` with secrets `CLOUDFLARE_API_TOKEN` (scoped to Workers and D1 edit on this
account) and `CLOUDFLARE_ACCOUNT_ID`, plus variable `STAGING_URL`. Migrations run only when you tick the box.
Actions are referenced by major tag; consider pinning to commit SHAs.

## What the build guarantees

`npm run build[:staging]` fails if: content is invalid, types fail, demo text/mock poll code/secrets appear in
`dist/`, an inline event handler would break the CSP, or noindex/robots are wrong for the environment.
`dist/_headers` is generated with a strict CSP (script hashes computed from the built HTML, no third parties),
HSTS, nosniff, referrer and permissions policies; HTML is cached 60 s, fingerprinted assets for a year.

## Cache and corrections

HTML is short-cached so an editorial correction goes live quickly. After deploying a correction, purge the page in
the Cloudflare dashboard (Caching → Purge) and re-run the smoke test. Status correction procedure:
`docs/EDITORIAL.md`.

## Rollback

- **Worker/static assets:** `npx wrangler rollback --env staging` (or redeploy the previous commit).
- **Database:** migrations are forward-only and additive. Before any schema change, take an export:
  `npx wrangler d1 export DB --env staging --remote --output backup-$(date +%F).sql`. Also check whether D1 Time
  Travel is available on your plan.
- **Secrets:** rotating `VOTER_HMAC_SECRET` invalidates every voter cookie and changes all stored hashes, so
  everyone could vote again that day. Rotate only at a poll-day boundary and only if it was exposed.

## Usage and cost monitoring checklist

- [ ] Cloudflare dashboard → Workers & Pages → this Worker: requests and errors (observability is enabled).
- [ ] D1 → database → metrics: rows read/written vs. your plan's limits.
- [ ] Notifications: enable usage and billing alerts available on your plan.
- [ ] Write down the current quotas you verified and the date, here or in your notes.
- [ ] After each editorial deploy: run the smoke test and eyeball the status/news on the live URL.

## Production

`env.production` exists in `wrangler.jsonc` (custom domain `flaviojafoipreso.com.br`, off `workers.dev`, its own D1
and secret, daily retention cron). Nothing is created or deployed until you do the steps below.

### Prerequisites (you)
1. **Put the domain on Cloudflare.** `flaviojafoipreso.com.br` currently uses Registro.br's default nameservers
   (`a.auto.dns.br`, `b.auto.dns.br`) and has no records. In Cloudflare: Add a site → copy the two nameservers it gives
   you → in Registro.br, change the domain's DNS servers to those. Wait until Cloudflare shows the zone as Active.
   (`.com.br` supports DNSSEC: if it is enabled at Registro.br, follow Cloudflare's DNSSEC steps or disable it before
   switching, otherwise the domain can stop resolving.)
2. **Privacy contact must exist.** Enable Cloudflare **Email Routing** and create `privacidade@flaviojafoipreso.com.br`
   forwarding to an inbox you read, then set `"contactEmailConfirmed": true` in `src/data/site.json`. The production
   build refuses to run until you do.
3. **Token permissions.** The OAuth login used so far may lack zone/DNS scopes. If `wrangler deploy` cannot attach the
   custom domain, create an API token with Workers Scripts:Edit, D1:Edit, Zone:Read and Workers Routes/Custom
   Domains permissions, and use it as `CLOUDFLARE_API_TOKEN`.
4. **Legal review** of `/privacidade` (it is a draft).

### Go-live (once, in order)
```bash
npx wrangler d1 create fjfp-production      # paste the id into env.production in wrangler.jsonc, commit
npm run db:migrate:production               # schema (both migrations)
npm run db:seed:production                  # the real poll
openssl rand -hex 32 | npx wrangler secret put VOTER_HMAC_SECRET --env production   # a NEW secret, not staging's
npm run deploy:production                   # guards -> production build -> deploy (attaches the custom domain)
npm run health:production                   # smoke test against the live domain
```
Then add a **Redirect Rule** in Cloudflare (Rules → Redirect Rules): `www.flaviojafoipreso.com.br/*` →
`https://flaviojafoipreso.com.br/${1}`, 301, plus a proxied DNS record for `www` so the rule can fire.
Afterwards check: `curl -sI https://www.flaviojafoipreso.com.br` redirects; the page is indexable (no `noindex`);
`/privacidade` loads; one real test vote works and is then removed if you do not want it counted
(`wrangler d1 execute DB --env production --remote --command "DELETE FROM votes"` before announcing).

Later releases use the manual **Deploy production** GitHub workflow (reviewer approval + typing `DEPLOY`).

### Cron check
After the first production deploy, confirm the retention trigger is registered (Workers & Pages → Worker →
Settings → Triggers → Cron) and look at its first run's logs next morning: it should print only a date and a count.
