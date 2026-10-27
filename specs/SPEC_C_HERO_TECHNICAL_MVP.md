# Specification C — Minimalist Hero: Technical MVP

**Project:** Flávio Já Foi Preso?  
**Status:** Proposed production engineering specification; implement only after reviewing the existing Hero prototype.  
**Depends on:** `specs/SPEC_A_MINIMALIST_HERO.md` and the currently implemented Hero UI.  
**Scope:** Production data, voting, publishing, security, operations, and inexpensive hosting. **Do not redesign the Hero.**  
**Language:** Brazilian Portuguese UI; English code/documentation is acceptable.

## 1. Product and engineering objective

Turn the chosen Minimalist Hero visual prototype into a trustworthy, low-maintenance, ultra-lightweight political satire site. The primary question is whether Flávio Bolsonaro has been arrested. The visual answer must be based on a **human-verified, timestamped, cited** status record, not an inference from news headlines. The site also shows three sourced news items and a non-scientific prediction poll (Presômetro).

The website is satire, not an official judicial source. A legal investigation, travel restriction, accusation, or court filing is **not** by itself an arrest. Do not assume an arrest is imminent. Display a prominent disclaimer and verification date. Do not invent news, legal facts, sources, vote counts, or user participation.

**Success conditions:** $0/month infrastructure at low traffic (excluding domain), no always-on server, static-first UX, no secrets in the browser, and graceful degradation if the voting API is unavailable.

## 2. Architectural decisions

- **Frontend:** Existing Astro + TypeScript project; preserve the current Hero design and its CSS. Use `output: 'static'`.
- **Static content:** Status, news and editorial metadata committed as JSON/TS in Git, validated at build time. Astro pre-renders them.
- **Hosting:** Cloudflare Workers with static assets (or Cloudflare Pages if simpler for the existing repo). Configure a custom `.com.br` domain, HTTPS, CDN caching and redirect from `www` to apex (or vice versa).
- **Poll backend:** One Cloudflare Worker API with Cloudflare D1. Only poll routes are dynamic. Separate local mock and production adapters behind the existing `PollRepository` interface.
- **Assets:** Local optimized WebP/AVIF portrait, SVG favicon and build-generated social image; do not hotlink images. Reuse the existing approved portrait asset.
- **Pinata/IPFS:** Optional archival/mirroring of static releases, **not** a vote store or primary API. Make it a separate optional deployment task, not a production dependency.
- **No** user accounts, CMS, React, third-party analytics SDK, LLM-generated publication, scraping on every page request, or paid services in the initial MVP.

Keep deployment and database integration isolated from visual components. Avoid introducing a monorepo unless the existing project structure clearly benefits.

## 3. Status verification and editorial controls (highest priority)

### Status model

```ts
type ArrestStatus = 'yes' | 'no' | 'unverified';
type Source = {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string; // ISO 8601
  accessedAt?: string;
};
type StatusRecord = {
  subject: 'flavio-bolsonaro';
  status: ArrestStatus;
  checkedAt: string | null; // ISO 8601 with timezone
  verifiedBy: string; // editor identifier, not necessarily public
  evidence: Source[];
  editorialNote?: string;
};
```

- A `yes` status requires explicit, reliable evidence that an arrest occurred. A `no` status requires a **recently checked** status and must not be treated as permanently valid.
- If no reliable check exists, or verification is older than the editorial freshness threshold, render **“NÃO VERIFICADO”**, not `NÃO.`. Suggested default threshold: 24 hours; make it configurable. **Important:** because a purely static build cannot age itself, implement a tiny client-side freshness guard using the timestamp embedded in the static HTML. This must work without the poll API. On initial static HTML, prefer an appropriately cautious status if the site cannot guarantee timely rebuilds; document the trade-off between no-JS fallback and freshness.
- Display `Última verificação: DD/MM/AAAA às HH:mm (Brasília)` and link to a short `Como verificamos` section. Dates must use `America/Sao_Paulo` formatting.
- Use a documented review checklist: identify primary/credible sources, confirm exact person, differentiate arrest vs other procedural measures, review conflicting information, record timestamps, and approve change in a Git PR.
- Never auto-promote status from news feeds or AI output. No automatic transition to `yes`.
- Include an emergency editorial procedure for correcting a false status: revert/update content, redeploy, invalidate relevant cache, regenerate social preview, record correction.

### Build validation

Create `scripts/validate-content.ts` using a small schema validator (Zod is acceptable) or plain TypeScript validation. Fail build if:
- `status` is `yes` or `no` without `checkedAt` or supporting sources;
- source URLs are not HTTPS;
- date formats are invalid;
- news IDs are duplicated;
- a news entry claims a source but lacks a valid link;
- poll close date is before start date.

Validation must not pretend to prove a news article's truth; it only enforces data integrity.

## 4. News publishing

Store news in `src/data/news.json` with `id`, `headline`, `summary`, `publishedAt`, `source`, `reviewedAt`, `reviewedBy`, and optional `correctionOf`.

- Render the **three most recently published approved** items, sorted descending by publication timestamp. If fewer than three exist, show only verified entries plus a clear empty state; never fill with fake articles.
- Each entry links directly to the original article and shows publication date and publisher. Use `rel="noopener noreferrer"` for external links opened in a new tab.
- No live fetching from publishers on page load. News changes require Git commit/PR and rebuild.
- Optional later phase: a scheduled discovery job that produces **draft candidates only**, never auto-publishes. Exclude it from the first MVP.
- Provide a sample content fixture for local development that is visibly marked as demo and is excluded from production builds.

## 5. Presômetro — exact behavior

**Question:** `Você acha que Flávio Bolsonaro será preso até 27/10/2027?` (configurable fixed end date; approve before public launch). **Never** silently convert this into a rolling 12-month question. A poll has a stable ID and immutable question/start/end dates once votes exist.

UI states: loading, open/unvoted, submitting, voted, closed, rate-limited, temporarily unavailable. After successful vote, show percentages, totals, and `Enquete informal, voluntária e não científica`. Display no fabricated counts. Do not imply voting has legal effect.

### API contract

`GET /api/polls/current` returns:

```json
{
  "id": "arrest-by-2027-10-27",
  "question": "Você acha que Flávio Bolsonaro será preso até 27/10/2027?",
  "startsAt": "2026-10-27T00:00:00-03:00",
  "closesAt": "2027-10-27T23:59:59-03:00",
  "state": "open",
  "yes": 0,
  "no": 0,
  "total": 0,
  "viewerHasVoted": false
}
```

`POST /api/polls/:id/votes` accepts `{ "choice": "yes" | "no" }` with a browser-held anonymous random voter token sent via a secure, same-site cookie or explicitly designed token header. Prefer a server-issued, signed, HttpOnly, Secure, SameSite=Lax cookie when serving same-origin requests; document first-visit flow and CSRF protection. Return appropriate `201`, `409` (already voted), `429` (rate limit), `400`, and `503` responses. Avoid revealing voter identity.

### Database

D1 tables:

```sql
CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  choice TEXT NOT NULL CHECK (choice IN ('yes', 'no')),
  voter_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(poll_id, voter_hash)
);
CREATE INDEX votes_poll_choice_idx ON votes(poll_id, choice);
```

Use a cryptographically random browser identifier and server-side keyed HMAC for the stored voter hash. Never store the raw identifier in D1. A cookie/browser-level one-vote rule **cannot** stop determined repeat voting, so disclose the limitation. For launch, use Cloudflare Turnstile or a comparable bot challenge **only if needed**; prefer low-friction protection plus rate limits. Avoid fingerprinting, third-party trackers, and retaining raw IP addresses. Set an explicit retention policy for vote records and secrets rotation.

Implement writes atomically via the unique constraint; do not trust frontend counters. Results are computed from persisted votes (or transactionally maintained aggregates after profiling). Cache GET results briefly (e.g., 15–30 seconds) while ensuring `viewerHasVoted` is never leaked across users by shared caching. Simplest approach: cache only anonymous aggregate counts and resolve per-viewer state separately or use `Cache-Control: private, no-store` until correct cache separation is implemented.

### Abuse and security

- Same-origin API preferred. Strict allowed origins; reject cross-site vote requests; check Origin and enforce SameSite cookie protections.
- Validate request body, choice enum, poll ID, request size and content type server-side.
- Limit repeated requests, with a documented response for legitimate users behind shared networks.
- No personally identifying data in client logs or analytics. Do not expose database binding or HMAC key.
- Return no-store headers on vote responses; protect secrets with Worker environment secrets.
- Use Cloudflare's platform protections; no custom homegrown CAPTCHA.

## 6. Local development and environments

Provide `npm run dev` for the Astro site and an easy local API mode (`wrangler dev` + local D1 or an explicitly documented proxy). The Hero should still run without the API using the existing demo adapter.

Use three environments:
- **Demo:** current local mock counts, visibly labeled, no network dependency.
- **Staging:** deployed Worker + test D1, fake poll ID and non-public URL, never indexed.
- **Production:** real votes and editorially approved content, isolated D1, secrets, domain.

Suggested configuration: `PUBLIC_POLL_MODE=mock|api`, `PUBLIC_API_BASE_URL` only if separate origin is unavoidable, `STATUS_MAX_AGE_HOURS=24` at build time plus equivalent client setting, Worker `VOTER_HMAC_SECRET` secret, D1 binding. Never ship a secret in `PUBLIC_` variables.

The mock adapter must never be enabled accidentally on the production domain. Add a build-time guard for production.

## 7. Hosting, cost, and IPFS

Default: Cloudflare static hosting plus a Worker/D1 for polls. Free-tier quotas and pricing **must be checked at deployment time**; do not hardcode assumptions that $0 is guaranteed at any traffic level. Add a cost/usage dashboard checklist and alerting where available. Domain registration is a separate annual expense.

Deploy static assets on each approved merge to `main`; deploy Worker migrations explicitly and safely. Ensure custom-domain routing sends `/api/*` to the API while static pages remain CDN-served. Set sensible cache headers: hashed assets immutable; HTML short cache with ability to purge; API responses not globally cached unless safely separated.

**Pinata:** Optional `npm run publish:ipfs` after a successful static build. Upload only the static `dist/` release, record CID + Git commit SHA in a release manifest, and optionally publish a link to an archive. Never upload Worker secrets, D1 data, or user votes. IPFS snapshots are immutable and may preserve outdated statuses; show an archive timestamp and do not advertise an old snapshot as the live legal status. Do not require Pinata for the live site.

## 8. SEO, sharing, and privacy

- Set `lang="pt-BR"`, unique title/description, canonical URL, `robots.txt`, sitemap only if useful, and an explicit satire disclaimer.
- OG/Twitter preview: question and neutral visual by default, **not a stale `NÃO.`**. If the preview includes a status, generate it from the same verified record and invalidate on changes. Social crawlers cache aggressively; prefer neutral preview for reliability.
- Privacy notice in Portuguese: explain poll identifier/cookie, purpose, retention and absence of user accounts. Check applicable Brazilian privacy requirements (LGPD) before public launch; this is an implementation checklist, not legal advice.
- No Google Analytics, ad pixels, fingerprinting, third-party fonts, or embedded news widgets in the initial MVP. Consider aggregate, privacy-respecting edge metrics later.
- Accessibility: keyboard-operable poll, live region for result/error updates, WCAG 2.2 AA target, visible focus, color-independent vote labels, `prefers-reduced-motion` support.

## 9. Performance and resilience

- Preserve current Hero layout. Initial HTML must include the question, status/verification metadata, news, and disclaimer without waiting for JavaScript.
- Target <75 KB compressed HTML+CSS+JS excluding images; poll JS <20 KB compressed; no client framework.
- Optimize portrait to responsive WebP/AVIF; reserve dimensions and avoid layout shift. Defer noncritical assets.
- Site must remain readable and factual if the Worker or D1 fails. Poll shows `Presômetro temporariamente indisponível`, never fake results.
- Provide a safe no-JS fallback for voting (`Ative JavaScript para participar`) and status freshness disclosure.

## 10. Tests and observability

Required tests:
1. Schema validation for good/bad content, invalid dates and missing evidence.
2. Status `yes/no/unverified`, including stale timestamp fallback.
3. News ordering, maximum three entries, empty state and external links.
4. Poll input validation, duplicate-vote uniqueness, closed poll, rate limiting, concurrent votes, API errors.
5. No mock poll counts on production builds.
6. Responsive smoke tests at 320, 375, 768, 1440 px; keyboard-only interaction.
7. `npm run build` and static output check.
8. Basic security tests for cross-origin POST, missing/invalid token, malformed JSON, and secret exposure.

Operational checklist: deploy health check, monitor Worker/D1 usage, log only sanitized error metadata, verify correct status after each editorial deploy, test cache invalidation and rollback. Prefer simple provider-native logging over adding monitoring vendors.

## 11. Implementation sequence (small, reviewable PRs)

**PR 1 — Editorial data integrity:** typed models, content validation, status freshness behavior, source policy, verified-news rendering. No visual redesign.

**PR 2 — Local production-shaped poll:** Worker + local D1 schema, repository adapter, API contracts, cookie/duplicate protections, tests; preserve mock mode.

**PR 3 — Cloudflare staging:** Worker/static routing, test database, staging environment, deployment docs, security checks, usage monitoring.

**PR 4 — Production readiness:** real editorial content, privacy/disclaimer, neutral OG image, domain/HTTPS, production D1, backup/rollback plan, final QA.

**Optional PR 5 — Pinata archive:** release snapshots with CID and archival warning. Not on the critical path.

## 12. Acceptance criteria

- Existing Minimalist Hero appearance remains effectively unchanged, except necessary status and poll states.
- Site renders without poll API, and never substitutes fabricated live numbers.
- Published status is verified, sourced, timestamped, and handles staleness conservatively.
- News is manually approved and linked to real sources.
- Real votes persist in D1, duplicate browser-token votes are rejected, and counts come from the database.
- The same poll question and end date apply to every recorded vote.
- Site builds/deploys as static Astro plus a tiny Worker, with no always-on paid server.
- All secrets stay server-side; no raw IP/fingerprinting database; documented privacy handling.
- Staging and production databases are isolated; rollback documented.
- Mobile and desktop performance remain close to the original prototype.
- Pinata is optional and does not affect live site availability.

## 13. Claude Code handoff prompt

> Read `specs/SPEC_A_MINIMALIST_HERO.md`, this specification, and the existing Astro implementation. The Minimalist Hero has been selected: **do not rebuild or restyle it**. First audit the current code against this production spec, propose a phased implementation plan with file-level changes and any decisions that require my approval, and **stop before implementing**. Prioritize verified editorial status/news and a real but inexpensive Presômetro backend. Maintain a zero-infrastructure local demo mode. Do not deploy, register domains, connect Pinata, or incur charges without explicit approval.

## 14. Decisions requiring approval before production

1. Final domain and canonical host (`www` or apex).
2. Exact Presômetro question and fixed close date.
3. Editorial owner(s), acceptable source standard, and verification frequency.
4. Whether to use Turnstile immediately or only after abuse appears.
5. Whether the portrait is approved for publication and whether social previews should be neutral.
6. Retention policy and public privacy wording.

**Non-goals:** Automated legal conclusions, AI-authored unsupervised news, user profiles, leaderboards, paid subscriptions, real-money betting, a second layout, and speculative arrest countdowns.
