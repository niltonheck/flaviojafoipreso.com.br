# Automated editorial job (hourly)

A Cloudflare Worker cron (`0 * * * *`) reads the trusted outlets' RSS feeds, publishes verbatim headlines about
Flávio Bolsonaro, and re-checks the status. It is **off by default**: nothing runs, and the page ignores any stored
state, unless the Worker variable `AUTOMATION_ENABLED` is exactly `"true"` (the kill switch).

This deliberately relaxes Spec C §3 ("never auto-promote status from AI output") in one direction only: the job may
*keep* "NÃO." fresh, but it can **never** set "SIM" and every doubt drops the site to "NÃO VERIFICADO".

## What it does each hour
1. Fetch the feeds in `src/data/feeds.json` (G1, Folha, Poder360, Agência Brasil). Only links on
   `src/data/trusted-sources.json` are kept; redirect wrappers are unwrapped; tracking params are dropped.
2. **News:** headlines whose title names Flávio Bolsonaro (not Flávio Dino, not a passing mention) are stored
   **verbatim** with publisher, link and timestamp. No AI writes any text. The page shows the 3 newest.
   Headlines that speculate about a *future* arrest ("prisão preventiva", "pode ser preso", "pedido de prisão"…) are
   not published (the site never implies an arrest is imminent) but are still shown to the status check.
3. **Status**, in this order. Any failure => `unverified`:
   1. enough live feeds (≥3 feeds, ≥2 outlets, newest item < 48 h old) — else `feeds-unhealthy`
   2. at least one headline about him in the last 48 h — else `no-recent-coverage`
   3. **keyword tripwire** (no AI): positive arrest phrasing in a headline ("Flávio é preso", "PF prende Flávio"…;
      negation-aware) — `arrest-signal-keyword`
   4. **Gemini** classifier (`worker/gemini.ts`): "does any item report an arrest?" Strict JSON, temperature 0.
      `yes` / `uncertain` / malformed / unverifiable => unverified. A `yes` must quote text that really appears in the
      cited item, or the whole answer is rejected.
   5. only a clean `no` renews **NÃO.** with `checked_at = now`, labeled "Verificação automática" on the page.
4. Email an alert **only when the status changes** (to or from "NÃO VERIFICADO") or the job crashes.

If the job itself crashes, it sets `unverified` (fail closed). A human-set status is never touched.

## Freshness
An automated status is valid for **3 hours** (`AUTO_MAX_AGE_HOURS`, two missed runs). If the cron dies, the page
degrades to "NÃO VERIFICADO" by itself. A manual status keeps the 72 h window.

## Human control
```bash
npm run site:show -- --env staging                         # current stored state + newest headlines
npm run site:hold -- yes --env staging --source <url> …    # you own the status ("yes" needs trusted HTTPS sources)
npm run site:hold -- no  --env staging                     # hold NÃO. yourself
npm run site:auto -- --env staging                         # hand control back to the hourly job
```
While a status is `manual`, the job still publishes news but never changes the status.

## Data flow
- Job writes D1: `status_state` (one row), `news_items` (newest 60), `editorial_runs` (counts/reason codes only).
- The page's existing `GET /api/polls/current` call also returns `site` (only when enabled): one request per visit,
  no extra Worker invocation. The browser validates it (`src/lib/site.ts`: https links only, bounded, closed enums)
  before touching the DOM, and silently keeps the build-time snapshot if anything is off.
- No-JS visitors see the build-time snapshot (git), as before.

## Turning it on (staging first)
1. **Gemini key** (you): create an API key, then `npx wrangler secret put GEMINI_API_KEY --env staging`.
   The model is pinned to `gemini-3.8-flash` (`GEMINI_MODEL` in `wrangler.jsonc`). Models get retired: when one does,
   the job fails closed ("NÃO VERIFICADO" + an alert) until you change that variable.
2. **Email alerts** (you): Cloudflare → Email → Email Routing → enable, add your inbox as a destination and verify it,
   then `npx wrangler secret put ALERT_TO --env staging` (that address). `ALERT_FROM` is `alertas@<your domain>`.
   The destination stays a secret so no personal address lands in the public repo.
3. Apply the migration: `npm run db:migrate:staging`, then set `AUTOMATION_ENABLED` to `"true"` for staging in
   `wrangler.jsonc` and deploy with the footer wording switched on: `PUBLIC_AUTOMATION=on npm run deploy:staging`.
   (`PUBLIC_AUTOMATION=on` only changes the footer text; the build check fails if that text appears without it.)
4. Watch the first runs: `npx wrangler tail --env staging` (logs print counts and reason codes only), and
   `npm run site:show -- --env staging`.
5. Production only after staging behaves for a few days: repeat with `--env production`.

## Unverified at the time of writing (check before relying on it)
- Gemini pricing and free-tier limits. (The live call itself was tested 2026-10-27 with the real code and real headlines:
  real coverage -> "no"; a synthetic arrest headline -> "yes" with a quote that verified; a prompt-injection attempt failed.
  `gemini-2.5-flash` is already retired for new users, hence the pinned `gemini-3.8-flash`.)
- Whether each publisher serves its RSS to Cloudflare's egress IPs (it worked from a home connection).
- Workers **Free** CPU limit (10 ms per invocation) vs. parsing six feeds each hour; Workers Paid raises it.
- Email Routing replaces the "null MX" records Cloudflare added for a send-nothing domain.
- Worker request quota: each page view already makes one Worker call (the poll); this adds none.

## Risks that remain
- The tripwire and Gemini can miss a real arrest reported only in prose or only outside the 6 feeds. Worst case the
  site shows "NÃO." for up to ~3 hours after an arrest. Unlike before, nothing ever shows "SIM" by itself.
- Feed text is untrusted: the prompt tells the model to ignore instructions inside it, and a "no" can only renew
  "NÃO."; it cannot publish text or "SIM". The headlines come from allowlisted outlets only.
