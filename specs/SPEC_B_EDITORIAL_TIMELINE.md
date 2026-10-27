# Specification B — Editorial Timeline

**Project:** Flávio Já Foi Preso? — Timeline Edition  
**Purpose:** Independent, locally testable visual prototype for Claude Code.  
**Stack:** Astro (required), TypeScript, vanilla CSS, minimal browser JavaScript.  
**Status:** Prototype; independent of the Minimalist Hero implementation.

## 1. Objective

Build a standalone editorial satirical website combining a bold **“FLÁVIO BOLSONARO JÁ FOI PRESO?” / “NÃO.”** status hero with a prominent **chronological legal-development timeline**, a small **Presômetro** poll and latest-news module. The experience should feel like a sophisticated newspaper explainer: editorial, readable, restrained, and sourced. Do not copy components from or depend on the other prototype.

The `NÃO.` in mockups is illustrative, not a prediction or an assertion that the status has been freshly verified. The production site must use verified evidence and a visible last-checked date, or show **“NÃO VERIFICADO”** when status is stale or uncertain.

## 2. Deliverables

- Standalone Astro project with `npm install` and `npm run dev`.
- Responsive homepage with a visually dominant timeline and status panel.
- Independently defined components, data files, styles, and image assets.
- Local simulated poll with no external backend.
- `README.md`, content schemas, build check, and straightforward Cloudflare static deployment instructions.
- No live legal-status scraping or AI-generated news publication in this prototype.

## 3. Layout and visual system

### Desktop (>= 1000px)

Use a 12-column editorial grid inside a 1200px max-width container:

- Masthead: full-width site name and a thin horizontal rule, newspaper-style metadata line `SÁTIRA POLÍTICA • ARQUIVO DE ACONTECIMENTOS`.
- Main left column (4/12): `Linha do tempo` with vertical line, date markers, category labels and 4–6 concise entries; scrolls naturally with page (no sticky inner scroll area).
- Main right column (8/12): top status hero with enormous red answer and stylized editorial portrait; below it, full-width Presômetro card and three-item news strip.
- Footer: source policy, legal-status methodology, disclaimer.
- The status and timeline should be visible together above the fold on a typical desktop screen; do not sacrifice legibility to achieve this.

### Mobile (< 1000px)

- Masthead first, status hero second, Presômetro third, timeline fourth, news fifth, footer last.
- Timeline remains a vertical list with a visible connecting rule; no horizontal scrolling.
- Portrait can be reduced, moved beside the status, or hidden on narrow screens.
- Preserve dates and sources without tiny type.

### Visual tokens

```css
:root {
  --paper: #f5f1e8;
  --card: #fffdf8;
  --ink: #1d1b19;
  --muted: #68645f;
  --accent: #ae1d22;
  --rule: #c9c2b7;
  --yes: #25844b;
  --no: #c63b36;
}
```

Use system serif (`Georgia`, Times) for editorial headlines and system sans for body/UI. Avoid remote fonts. Keep visual texture subtle; prefer rules, spacing, and typographic hierarchy to heavy shadows.

## 4. Components

- `Masthead.astro`: name, short satirical subtitle, subtle publication styling.
- `StatusPanel.astro`: question, answer, verification timestamp, methodology link, portrait illustration.
- `Timeline.astro`: date-ordered event list, vertical spine and nodes; categories and citations.
- `TimelineEvent.astro`: date, title, 1–2 sentence neutral summary, source links, event type.
- `Presometro.astro`: two-button fixed-deadline prediction poll, results bar, demo disclaimer.
- `LatestNews.astro`: three latest verified updates with publisher and date.
- `Footer.astro`: satire disclaimer, editorial policy.

## 5. Timeline data and editorial rules

Store content in `src/data/status.json`, `timeline.json`, `news.json`, `poll.json`.

```ts
type Status = 'yes' | 'no' | 'unverified';
type EventCategory = 'investigation' | 'court_decision' | 'defense_statement' | 'arrest_status' | 'other';
type Source = { publisher: string; title: string; url: string; publishedAt: string };
type TimelineEvent = {
  id: string;
  date: string;
  category: EventCategory;
  title: string;
  summary: string;
  sources: Source[];
};
type StatusRecord = { status: Status; checkedAt: string | null; evidence: Source[] };
type NewsItem = { id: string; title: string; source: Source };
type Poll = { id: string; question: string; closesAt: string; yes: number; no: number; simulated: boolean };
```

- Sort events newest first. Format dates in Brazilian Portuguese.
- Use 4–6 **clearly fictional UI placeholder events** for visual development, not invented accusations or court decisions attributed to real organizations. Example placeholders: `[Evento ilustrativo 01]`, `[Resumo a ser preenchido após verificação editorial]`.
- Production entries must include at least one valid primary or credible journalistic source, preferably multiple for significant legal assertions.
- Distinguish allegations, investigations, charges, court decisions, appeals, defense statements, and arrest; none implies another.
- Include material reversals, corrections, and defense positions when relevant. Do not infer guilt or an imminent arrest.
- Never use a fabricated publisher name or fake URL as though it were a real citation.

## 6. Presômetro local prototype

- Question example: **“Você acha que haverá prisão até 27/10/2027?”**
- Fixed end date; do not silently convert to rolling 12-month period.
- Simulated results (e.g. 68/32) explicitly marked **`DADOS DE DEMONSTRAÇÃO`**.
- `Sim` and `Não` update browser-only UI. Optional `sessionStorage` for local demo state.
- No server, login, IP capture, analytics, or database needed for local run.
- Create a typed `PollRepository` abstraction to allow future Cloudflare Worker + D1 integration.
- Display `Enquete informal, sem valor estatístico` and make clear that mock votes are not counted publicly.

## 7. Required images and generation prompts

**Asset B1: Editorial portrait — `public/images/flavio-engraving.webp`**

> Generate a recognizable but unmistakably illustrated portrait of Brazilian politician Flávio Bolsonaro for a satirical newspaper-inspired website. Head and shoulders, slightly looking upward, monochrome engraved-ink aesthetic, fine crosshatching, halftone shadows, subtle vintage Brazilian newspaper print treatment. Restrained editorial caricature, neutral facial expression, not a photorealistic or documentary image. Transparent background; clean subject silhouette. No text, handcuffs, prison bars, prison uniforms, weapons, court insignia, or suggestion that an arrest has happened. Vertical 4:5 framing, high-resolution source. Export an optimized WebP at approximately 640px width, target under 100 KB.

**Asset B2: Subtle paper texture — `public/images/paper-texture.webp`**

> Seamless subtle off-white aged-paper texture for a contemporary editorial website, warm ivory fibers and extremely fine printing grain, almost invisible at normal zoom, no stains, tears, folds, words, logos, or high-contrast patterns. Seamlessly tileable square 512×512. Export highly compressed WebP under 30 KB. The CSS solid paper color must work without this asset.

**Asset B3: Social preview — `public/og-image.png`**

> Design a 1200×630 newspaper-front-page-inspired social preview in Portuguese for a satirical website. Warm ivory paper, fine black horizontal rules, restrained deep-red accent, large serif headline “FLÁVIO JÁ FOI PRESO?”, giant red “NÃO.”, small clearly readable label “SÁTIRA POLÍTICA”, optional small engraved editorial portrait at right. No fake newspaper logos, no fabricated news headlines, no prison imagery. Maintain clean hierarchy and accurate accents. If AI-generated lettering is imperfect, create the image background/portrait only and typeset text programmatically in SVG or HTML/CSS.

The social preview must not contradict the current verified status in production. Prefer a neutral status-free OG variant until the editorial update process is reliable.

**Asset B4: Favicon — `public/favicon.svg`**: hand-authored simple newspaper-style `?` icon, dark red on ivory.

All image assets must be optional at runtime, with stable layout and CSS fallback. Image-generation prompts belong in the README too.

## 8. Architecture and hosting

- Astro with `output: 'static'` and TypeScript.
- Pre-render all timeline, status and news content from local JSON.
- Vanilla JS poll component only; no frontend framework needed.
- Static build in `dist/`.
- Optional future hosting: Cloudflare Workers static assets with free-tier allowances; use Cloudflare Worker + D1 only when implementing a shared public poll.
- Pinata can optionally pin versioned static builds or snapshots to IPFS; IPFS does not provide a writable shared voting database.
- Avoid backend, CMS, third-party analytics and secrets in prototype.

## 9. Performance, accessibility and SEO

- Target <100 KB compressed HTML/CSS/JS, excluding images; JS <20 KB compressed.
- Lazy-load noncritical portrait and texture, reserve image dimensions, and prefer CSS-only texture where feasible.
- Good heading hierarchy, `<ol>` for timeline, `<time datetime>` for dates, meaningful source link labels.
- Accessible color contrast, keyboard focus, responsive text, reduced motion, 44px poll controls.
- `lang="pt-BR"`, canonical URL only after domain selection, clear meta description and satire disclosure.
- No horizontal overflow at 320, 375, 768, 1024 and 1440px.

## 10. Suggested repository tree

```text
editorial-timeline/
├── public/images/
├── src/components/{Masthead,StatusPanel,Timeline,TimelineEvent,Presometro,LatestNews,Footer}.astro
├── src/data/{status,timeline,news,poll}.json
├── src/lib/{types,pollRepository}.ts
├── src/pages/index.astro
├── src/styles/global.css
├── astro.config.mjs
├── package.json
└── README.md
```

## 11. Acceptance criteria

1. Runs locally without any Cloudflare/Pinata credentials.
2. Timeline and hero appear side by side on desktop, stacked in specified order on mobile.
3. At least four clearly labeled placeholder events render in correct chronological order.
4. Each event supports category, date, summary, and source links when real content is supplied.
5. Hero handles `yes`, `no`, and `unverified` safely.
6. Presômetro updates locally and visibly discloses simulated results.
7. No fabricated legal developments or falsely attributed articles appear as real news.
8. `npm run build` completes to a static `dist/`.
9. Missing images do not break the design.
10. README includes exact image prompts and optional Cloudflare/Pinata deployment notes.

## 12. Claude Code implementation instruction

Implement **only this specification** as a new, independent Astro application. Emphasize polished editorial typography, a clear chronological timeline, strong hierarchy and excellent mobile behavior. Keep all data local and demonstrative; do not fetch or invent live legal news. Generate or stub the requested assets, and preserve the exact image prompts in the README. Run the build and report how to preview locally. Do not implement or import the Minimalist Hero prototype.
