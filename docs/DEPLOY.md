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

## Production (PR 4)

`env.production` already exists in `wrangler.jsonc` (custom domain `flaviojafoipreso.com.br` assumed; confirm),
but it has no deploy script on purpose. PR 4 adds: its own D1 and secret, the zone on Cloudflare, `www` → apex
via a Cloudflare Redirect Rule (the Worker only runs for `/api/*`, so the redirect belongs in the dashboard),
privacy notice, neutral social image, retention job, and a production deploy workflow with manual approval.
