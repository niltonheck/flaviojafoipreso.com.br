# Presômetro API (Worker + D1)

Same-origin only: the Worker handles `/api/*`; everything else is static assets served by the CDN
(`run_worker_first: ["/api/*"]`). No CORS headers are sent, so other sites cannot call it from a browser.

**One vote per voter per day.** The question and the deadline (27/10/2027) never change; what changes is the
tally day. A "day" is the calendar day in America/Sao_Paulo; the count shown is *today's* tally and restarts at
midnight Brasília. After the poll closes, the whole-poll total is shown.

## `GET /api/polls/current`

```json
{
  "id": "arrest-by-2027-10-27",
  "question": "Você acha que Flávio Bolsonaro será preso até 27/10/2027?",
  "startsAt": "2026-10-27T03:00:00.000Z",
  "closesAt": "2027-10-28T02:59:59.000Z",
  "state": "open",            // open | closed | upcoming
  "day": "2026-10-27",        // Brasília day the tally covers; null when closed
  "yes": 0, "no": 0, "total": 0,
  "viewerHasVoted": false,    // for *today*, for this browser only
  "viewerChoice": null        // "yes" | "no" | null
}
```

Counts come from persisted votes and are never invented. Responses are `Cache-Control: private, no-store`.
Inside the Worker, only the anonymous aggregate counts are cached (15 s, dropped on every new vote); per-viewer
fields are always computed fresh, so nothing leaks between users.

## `POST /api/polls/:id/votes`

Body: exactly `{ "choice": "yes" | "no" }`, `Content-Type: application/json`, ≤ 1 KB.

| Status | `error` | Meaning |
|---|---|---|
| 201 | – | Vote recorded; body is the same shape as `GET` |
| 400 | `invalid_body` | Malformed JSON, wrong type, extra keys, bad `choice` |
| 400 | `invalid_voter` | Missing/forged voter cookie → client re-`GET`s, then retries once |
| 403 | `forbidden_origin` | Missing/foreign `Origin`, or `Sec-Fetch-Site: cross-site` |
| 403 | `poll_closed` / `poll_upcoming` | Outside the poll window |
| 404 | `poll_not_found` | Unknown poll id |
| 409 | `already_voted` | This browser already voted today |
| 413 / 415 | `payload_too_large` / `unsupported_media_type` | |
| 429 | `rate_limited` | `Retry-After: 60`. May hit legitimate users behind a shared network (e.g. carrier NAT); the UI asks them to try again shortly |
| 503 | `unavailable` | Config/D1 failure. Generic body; details only in sanitized logs |

Other: `405` wrong method, `404` unknown `/api/*` path.

## Voter identity and first visit

1. First `GET` has no cookie → server creates a 128-bit random id and sets
   `fjfp_vid=<id>.<HMAC signature>; Path=/api; HttpOnly; SameSite=Lax; Max-Age=400d` (`Secure` on https).
2. `POST` requires a valid signed cookie. The signature stops tampering; it does not stop someone from simply
   clearing cookies.
3. D1 stores only `HMAC-SHA256(VOTER_HMAC_SECRET, "voter:" + pollId + ":" + day + ":" + id)`; the raw id never
   reaches the database. The hash is **scoped to the poll and the Brasília day**, so the same browser has an
   unrelated code each day and votes on different days cannot be joined or linked. The cookie signature and the
   rate-limit keys use different prefixes so the values cannot be confused.

**Known limitation (disclosed in the UI):** a browser-level rule cannot stop a determined person from voting
repeatedly (private windows, cleared cookies). This is an informal poll with no statistical value.

## Cross-site protection

`Origin` must be present and equal the site origin (or be listed in `ALLOWED_ORIGINS`, e.g. the `www` host);
`Sec-Fetch-Site: cross-site` is rejected; JSON content type forces a CORS preflight that always fails (no CORS
headers); the cookie is `SameSite=Lax`, so browsers do not attach it to cross-site POSTs.

## Rate limiting

A Workers Rate Limiting binding (`VOTE_LIMITER`, 20 per 60 s) is checked per hashed IP and per voter cookie. The
keys are non-reversible hashes held only by the limiter; **no IP is stored in D1 or logs**. Confirm current quota,
pricing and behavior at deploy time and consider a Cloudflare WAF rate rule in front (PR 3).

## Data and retention

Tables: `polls`, `votes`, `poll_day_totals`. `votes` has `votes_poll_day_choice_idx` and
`UNIQUE(poll_id, day, voter_hash)`, which makes writes atomic: a duplicate is rejected by the database, never by
a read-then-write. Poll rows are immutable once votes exist (create a new poll instead).

**Retention (decided):** a per-voter code is only needed to stop a second vote on the same day, so it does not
outlive its day by more than 48-72 h. A daily cron (`0 5 * * *` = 02:00 Brasília, `worker/retention.ts`) rolls every
day that ended at least 48 h ago into `poll_day_totals` (anonymous yes/no counts) and deletes that day's `votes`
rows, in one D1 batch (all-or-nothing; re-running never double-counts). The job never touches recent days, the only
days that can still receive votes. Once a poll is closed, the final result is `poll_day_totals` + any not-yet-purged
votes. Logs from the job contain counts and a date only.

## Local development

```bash
cp .dev.vars.example .dev.vars          # then set VOTER_HMAC_SECRET:  openssl rand -hex 32
npm run db:reset:local                  # local D1: migrations + staging seed (fake poll id)
npm run preview:api                     # builds the site with the real API poll + `wrangler dev` on :8787
```

`npm run dev` still works with no API at all (demo adapter). A production build refuses
`PUBLIC_POLL_MODE=mock`. Never put the HMAC secret in a `PUBLIC_*` variable.
