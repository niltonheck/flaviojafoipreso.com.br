# Automated editorial job (3x/day)

**The answer on the page is "NÃO." unless a human has recorded "SIM" with at least one trusted source.** There is no
"NÃO VERIFICADO" state, no expiry, and nothing the automation can do changes the answer. (This deliberately replaces
Spec C §3's "unverified when stale" rule, by the owner's decision: the default is the joke, and the only claim that
needs proof is "SIM".)

A Cloudflare Worker cron (`0 1,9,17 * * *` UTC = 22:00, 06:00 and 14:00 Brasília) does two things. It is **off by
default**: nothing runs, and the page ignores any stored state, unless the Worker variable `AUTOMATION_ENABLED` is
exactly `"true"` (the kill switch).

1. **Publishes news**: headlines from the trusted outlets' RSS feeds that name Flávio Bolsonaro, verbatim.
2. **Watches for an arrest and tells you**: it never sets the answer, it emails the editor.

## What it does each run
1. Fetch the feeds in `src/data/feeds.json` (G1, Folha, Poder360, Agência Brasil). Only links on
   `src/data/trusted-sources.json` are kept; redirect wrappers are unwrapped; tracking params are dropped.
2. **News:** headlines whose title names Flávio Bolsonaro (not Flávio Dino, not a passing mention) are stored
   **verbatim** with publisher, link and timestamp. No AI writes any text. The page shows the 3 newest. Headlines that
   speculate about a *future* arrest ("prisão preventiva", "pode ser preso", "pedido de prisão"…) are not published
   (the site never implies an arrest is imminent) but are still shown to the check below.
3. **The check**, in this order:
   1. enough live feeds (≥3 feeds, ≥2 outlets, newest item < 48 h old), else `cannot-verify: feeds-unhealthy`
   2. at least one headline about him in the last 48 h, else `cannot-verify: no-recent-coverage`
   3. **keyword tripwire** (no AI): positive arrest phrasing in a headline ("Flávio é preso", "PF prende Flávio"…;
      negation-aware), so `arrest-signal-keyword`
   4. **Gemini** (`gemini-3.8-flash`): "does any item report an arrest?" Strict JSON, temperature 0. `yes` or `uncertain`
      is an `arrest-signal`; a malformed or unverifiable answer is `cannot-verify`. A `yes` must quote text that really
      appears in the cited item, or the whole answer is rejected.
4. **Result.** A clean check renews the "last check" time (shown as "Verificação automática"). Anything else keeps the
   previous time. **The answer is "NÃO." either way.**
5. **Email**, only when the condition *changes* (no repeat spam):
   - `arrest-signal`: "Possível sinal de prisão: confira", with the quotes and the exact command to record a SIM
   - `cannot-verify` or a job crash: "A checagem automática não conseguiu verificar"
   - back to normal: "Checagem automática normalizada"

## Recording a SIM (human only)
```bash
npm run site:hold -- yes --env production --source <url> [--source <url>]   # needs >=1 trusted HTTPS source
npm run site:auto -- --env production                                        # back to NÃO (the job resumes)
npm run site:show -- --env production                                        # stored state + newest headlines
```
A `yes` without a source is ignored everywhere (server, page, validator). While a SIM is recorded the job still
publishes news but never touches it. For the git snapshot (used until the first run, and by no-JS visitors):
`npm run status:set -- yes --source <url>` / `npm run status:set -- no`.

## Data flow
- The job writes D1: `status_state` (one row), `news_items` (newest 60), `editorial_runs` (counts/reason codes only).
- The page's existing `GET /api/polls/current` call also returns `site` (only when enabled): one request per visit,
  no extra Worker invocation. The browser validates it (`src/lib/site.ts`: https links only, bounded, closed enums)
  before touching the DOM, and silently keeps the build-time snapshot if anything is off.

## Turning it on
1. **Gemini key**: `! npx wrangler secret put GEMINI_API_KEY --env production` (staging: `--env staging`).
2. **Email alerts** (strongly recommended: they are now the *only* safety net, because the page can no longer degrade):
   Cloudflare → Email → Email Routing → enable, add your inbox as a destination and verify it, then
   `! npx wrangler secret put ALERT_TO --env production`. `ALERT_FROM` is `alertas@<your domain>`.
3. `AUTOMATION_ENABLED` is `"true"` for production in `wrangler.jsonc`; deploy with the footer wording switched on:
   `PUBLIC_AUTOMATION=on npm run deploy:production` (the build check fails if that wording appears without the flag).
4. Watch the first runs: `npx wrangler tail --env production` (counts and reason codes only) and `npm run site:show`.
   Cloudflare can take ~10 minutes to start firing a newly deployed schedule.

Models get retired (`gemini-2.5-flash` already is for new users). When the pinned one is, the job reports
`classifier-error` and emails you until you change `GEMINI_MODEL` in `wrangler.jsonc`.

## Unverified at the time of writing
- Gemini pricing and free-tier limits. (The live call was tested 2026-10-27 with the real code and real headlines:
  real coverage -> "no"; a synthetic arrest headline -> "yes" with a quote that verified; a prompt-injection attempt failed.)
- Email Routing replaces the "null MX" records Cloudflare added for a send-nothing domain.
- Workers Free CPU limit (10 ms per invocation): the staging run completed, but watch for CPU errors in the tail.

## Risks that remain
- **The page can say "NÃO." after a real arrest until a human records the SIM.** The job shortens that by emailing you
  at the next run (up to ~8 h), but if the alert email is not configured, or a headline is only in prose or outside the
  4 outlets, nobody is told. Setting up the email is the most valuable safety step.
- **A dead job is invisible on the page** (the "last check" time just gets old). The email for a crash or an unreadable
  feed set is the signal.
- Feed text is untrusted: the prompt tells the model to ignore instructions inside it, and the model cannot publish text
  or change the answer. Headlines come from allowlisted outlets only.
