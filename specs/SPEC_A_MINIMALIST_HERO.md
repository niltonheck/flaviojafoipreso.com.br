# Specification A — Minimalist Hero

**Project:** Flávio Já Foi Preso?  
**Purpose:** Independent, locally testable visual prototype for Claude Code.  
**Stack:** Astro (required), TypeScript, vanilla CSS, minimal browser JavaScript.  
**Status:** Prototype; do not deploy as a live factual tracker without editorial verification.

## 1. Objective

Create a very lightweight satirical Brazilian Portuguese website whose dominant visual element is the question **“FLÁVIO BOLSONARO JÁ FOI PRESO?”** and an enormous red **“NÃO.”**. Below it, present a small **Presômetro** visitor prediction widget and three latest-news entries. This is **one independent Astro project**, not a route or theme of the timeline prototype.

The giant answer is **sample display content for local development only**. In a live deployment, never assert the answer unless supported by a current, independently verified status record. If stale or unverified, display **“NÃO VERIFICADO”**. Do not imply arrest is scheduled or imminent.

## 2. Deliverables

- Fully working Astro project runnable with `npm install` and `npm run dev`.
- `README.md` explaining local operation, how to change the sample content, how to run tests, and optional deployment.
- Responsive single-page design; no React/Vue/Svelte dependency.
- All images generated or supplied as assets, with graceful CSS-only fallback if images are missing.
- Local demo poll with clearly labeled simulated counts, no backend or external service required.
- Content validation and at least a basic smoke test/build check.

## 3. Layout

### Desktop (>= 900px)

- Maximum content width: 1080px, horizontally centered.
- Header: compact wordmark at left, discreet `Sobre` anchor at right.
- Hero: centered question in uppercase, enormous `NÃO.` in deep red, small verification line below.
- Lower section: two columns (approximately 48/52): Presômetro on left; `Últimas notícias` on right.
- Footer: concise satirical disclaimer, methodology and source links.
- Optional portrait: small, high-contrast editorial illustration near/above the hero question; **do not let it compete with the answer**.

### Mobile (< 900px)

- Header, hero, poll, news and footer stacked.
- Hero typography scales via `clamp()` and never overflows at 320px viewport width.
- Touch targets at least 44px high; avoid hover-only information.
- No horizontal scrolling.

### Visual tokens

```css
:root {
  --background: #fafaf7;
  --surface: #ffffff;
  --text: #171717;
  --muted: #737373;
  --red: #b91c1c;
  --green: #16803c;
  --border: #deded9;
  --radius: 12px;
}
```

Use system fonts. No web fonts, carousels, large icon packages, or entrance animations. Prefer whitespace and typography to decoration.

## 4. Components

- `SiteHeader.astro`: wordmark, optional About anchor.
- `StatusHero.astro`: question, answer, checked-at timestamp, link to verification explanation. Three status states: `yes`, `no`, `unverified`; map to `SIM.`, `NÃO.`, `NÃO VERIFICADO`.
- `Presometro.astro`: prediction question, two buttons, bar chart, vote count, disclaimer. The question must have a fixed reference period, e.g. **“Você acha que haverá prisão até 27/10/2027?”**; do not use rolling “next 12 months” with a permanently accumulating tally.
- `NewsList.astro`: exactly three latest verified news items, with source, publication date, external link.
- `SiteFooter.astro`: disclaimer and methodology.

## 5. Content model

Store data in `src/data/status.json`, `src/data/news.json`, `src/data/poll.json` with TypeScript types in `src/lib/types.ts`.

```ts
type Status = 'yes' | 'no' | 'unverified';
type Source = { publisher: string; title: string; url: string; publishedAt: string };
type StatusRecord = { status: Status; checkedAt: string | null; evidence: Source[] };
type NewsItem = { id: string; title: string; summary?: string; source: Source };
type Poll = { id: string; question: string; closesAt: string; yes: number; no: number; simulated: boolean };
```

Use **obviously fictional placeholder headlines** or empty-state text for local prototyping, never fabricated claims attributed to real outlets. Dates, vote totals, and sources must be explicitly labeled `DEMONSTRAÇÃO` until verified or connected to real data. Do not seed with purported current criminal developments.

## 6. Presômetro prototype behavior

- Start with local mock counts, e.g. 68/32, **visibly labeled simulated**, not real public opinion.
- Clicking `Sim` or `Não` updates the UI for that browser session; show `Voto de demonstração — não registrado publicamente`.
- Use `sessionStorage` if desired to retain the local demo vote; no tracking, fingerprints, or IP collection.
- Show a clearly visible error/empty state when counts are unavailable.
- Define a tiny `PollRepository` interface so a future Cloudflare Worker + D1 implementation can replace the mock adapter without changing UI.
- Never claim the local demonstration is a scientific or representative poll.

## 7. Required images and generation prompts

**Asset A1: Editorial portrait — `public/images/flavio-editorial.webp`**

> Create a recognizable, clearly stylized editorial illustration of Brazilian politician Flávio Bolsonaro, head and shoulders, slightly turned toward camera. Black-and-white ink engraving and restrained halftone newspaper texture, strong contrast, sophisticated satirical editorial aesthetic, neutral expression, clean isolated silhouette. Transparent background. No words, flags, handcuffs, prison bars, uniforms, invented events, or implications of guilt. Portrait 4:5 composition. Produce a high-resolution source and export a 480px-wide optimized WebP, aiming for under 60 KB. This is an illustration, not a documentary photograph.

**Asset A2: Social share image — `public/og-image.png`**

> Create a minimal 1200×630 social preview for a Brazilian satirical website. Warm off-white background, small black heading “FLÁVIO JÁ FOI PRESO?”, gigantic bold dark-red “NÃO.” centered, understated bottom caption “SÁTIRA POLÍTICA • STATUS SUJEITO A VERIFICAÇÃO”. Bold editorial typography, exceptional mobile thumbnail legibility, no fake logos, no photographs, no prison imagery. Ensure exact Portuguese accents and spelling. If typography is unreliable, generate only the background treatment and compose all text programmatically using HTML/CSS or SVG.

**Important:** The OG image's answer must match the verified live status. For local development it is a mockup; before production, generate OG previews from the same verified data as the page, or use a neutral headline-only image.

**Asset A3: Favicon — `public/favicon.svg`**: hand-authored SVG with a red `?` on off-white, not AI-generated.

Images are optional for runtime: implement an elegant typography-only fallback. Do not make image generation a blocker for the prototype.

## 8. Technical architecture

- Astro `output: 'static'`; use `.astro` components and vanilla CSS.
- No server-side runtime, database, API keys, or login needed locally.
- Build-time data imports for status and news.
- Poll island implemented in a small `<script>` using typed TypeScript, no framework hydration.
- `npm run build` produces static `dist/` suitable for Cloudflare Workers static assets or any static host.
- Pinata/IPFS is optional **for static snapshots only**. A real shared poll would require an API/database; do not write votes to static IPFS content.
- Keep third-party scripts at zero for MVP; do not include analytics by default.

## 9. Performance, accessibility and SEO

- Aim for <75 KB compressed HTML/CSS/JS combined, excluding images; JS <20 KB compressed.
- Portrait should be `loading="lazy"` unless actually in the initial hero viewport; reserve dimensions to avoid layout shift.
- Use semantic `<main>`, `<section>`, `<time>`, and heading order; keyboard-accessible poll, visible focus indicators, reduced-motion preference.
- Portuguese `lang="pt-BR"`, descriptive `<title>`, meta description, canonical URL only when domain selected.
- Mark the site clearly as satire; include `Não é fonte oficial` and source-verification methodology.
- Links to news must be real only when editorially approved; otherwise use a placeholder state, not fake clickable sources.

## 10. Suggested repository tree

```text
minimalist-hero/
├── public/images/
├── src/components/{SiteHeader,StatusHero,Presometro,NewsList,SiteFooter}.astro
├── src/data/{status,news,poll}.json
├── src/lib/{types,pollRepository}.ts
├── src/pages/index.astro
├── src/styles/global.css
├── astro.config.mjs
├── package.json
└── README.md
```

## 11. Acceptance criteria

1. `npm install && npm run dev` works without credentials or external infrastructure.
2. The large answer dominates the first viewport on desktop and mobile.
3. Poll buttons update the demo UI and explicitly disclose simulated counts.
4. Exactly three sample/verified news slots are visible, with no fabricated attributed reporting.
5. `unverified` renders a cautious alternative to `NÃO.`.
6. No horizontal overflow at 320, 375, 768, and 1440px.
7. `npm run build` completes and produces a fully static site.
8. No requests to external fonts, tracking services, or APIs.
9. Missing portrait does not break layout.
10. README documents image prompts and Cloudflare/Pinata deployment options.

## 12. Claude Code implementation instruction

Implement **only this specification** as a standalone Astro application. Prioritize pixel-level polish, mobile responsiveness, and a tiny bundle. Use local placeholder content and a demo-only poll; do not integrate live news, real votes, or external infrastructure. Run the build and report how to preview it locally. Do not create or import the Timeline variant.
