# STATUS

Session handoff tracker for Soundcheck. Update this file at the end of every session so the next agent can start cold.
Read order for a new session: `docs/RESEARCH.md` (research + API mapping) → `docs/PLAN.md` (strategy, architecture, schedule) → `docs/UX.md` (screens and visual direction) → `docs/STACK.md` (stack choices) → this file.

**Deadline:** Oct 30, 2026, 11:45 pm ET. Submit by Oct 29.

## Last updated
2026-10-13 (session 4)

## Session 4: evidence and submission readiness

- Explicit persisted and streamed provenance distinguishes synthetic, live API mode, and unknown legacy data. Source notes survive traces and CSV. Old plan copy is sanitized without rewriting saved originals.
- Removed claims about unplayed/unbooked markets, measured shared-fan percentages, localized demographics and full show break-even. Geographic comparisons remain explicitly unverified; room sizes and travel/crew figures are assumptions.
- Live identity badges require successful resolution evidence. Failed API calls do not imply confirmed data. Revisions cannot mix mock IDs and live evidence.
- Optional comparison now matches the brief and city constraints, rejects invalid outputs, and hides old, stale or different-model comparisons. It remains opt-in and is clearly described as illustrative, not a controlled quality benchmark.
- Homepage focuses on musician research with six-stop default; experimental categories are marked. Source labels appear on plans, tours, replay, print and exports. Print route/economics has a dedicated sheet.
- Custom plan/proposal endpoints have process-local concurrency and rolling-start limits. Health reads runtime configuration rather than build-time values.
- Public README rewritten; `docs/DEMO.md` supplies the walkthrough/submission draft; `docs/VALIDATION.md` supplies live-data gates and user-evaluation forms. No outreach, user benefit, or live validation is claimed.
- Verification: 202 tests, typecheck, lint, production build (including Vercel backend configuration) and diff checks passed. Desktop and 390px phone layout checked; isolated synthetic six-stop run, revision to five stops, parent preservation and CSV provenance passed with zero model calls. Print preview carries provenance and a separate route/economics sheet.
- Vercel production URL: https://soundcheck-amber-two.vercel.app . Public access and proxied Redis health verified. Server-rendered backend reads explicitly use `?stored=1`, so missing demos cannot trigger paid seed runs from homepage loading.
- Deployed application commit `7523998` to Vercel (deployment `89ipsjNxYgMPb6sfLgfsAqrapYtg`) and Railway (deployment `950e1627-6c56-4751-9cb7-1156c865508a`, SUCCESS). Both builds passed. GitHub `origin/main` contains the implementation.
- Hosted verification passed on the public Vercel URL: homepage, saved plan, tour and print routes, Redis health, CSV provenance, and read-only missing-plan 404 with no-store. In Chrome, keyboard reorder and Re-run created revision `EsvbCFJDzV` (Seattle then Vancouver) while `demo-musician` retained Vancouver then Seattle. Revision lineage and synthetic provenance persisted; no added Qloo/model calls. Desktop tour autoplay/pause/seek and print preview checked; 390px phone plan has no horizontal overflow. Actual browser print-to-PDF output was not generated. Temporary local test server stopped.
- Qloo key remains absent locally. Keep live validation and saved-example regeneration pending. User explicitly requested Vercel deployment/testing. Vercel project `soundcheck` created in `shunyatechs-projects`; Vercel web frontend uses the existing Railway agent API and private Redis over HTTPS. No public Redis endpoint or duplicated model credentials are required. `SOUNDCHECK_BACKEND_URL` is set only on Vercel; `ENABLE_EXPERIMENTAL_COREPACK=1` selects the pinned pnpm.

## Done
- [x] Research handoff written (`docs/RESEARCH.md`)
- [x] Build plan written (`docs/PLAN.md` + `docs/UX.md` + `docs/STACK.md`): strategy changes, UI screens, architecture, 19-day schedule, verification
- [x] Soundcheck Design System published (Claude Design artifact): tokens for Stage/Print themes, brand book, 13 components incl. animated TourCard, TourControls, MotionPrimitives, plus a Motion section in the brand book. Link in `docs/UX.md`.
- [x] Map tour (presentation mode) and app-wide motion specified in `docs/UX.md` screen 4 and the Motion section
- [x] **Session 2 build (2026-10-12), all four workstreams integrated, typecheck + 100 tests + lint + `pnpm build` green:**
  - Qloo tool layer `src/lib/qloo/**` from the live hackathon docs: client with retries and URL cache (Upstash or memory), redaction, tolerant zod schemas, live client for 10 call types with fallbacks, deterministic mock (QLOO_MOCK=1), city pools for 3 regions (`src/data/cities`)
  - Agent loop `src/lib/agent/**`: AI SDK tool calling on `claude-sonnet-5-5` with a coverage guard; runs deterministically with no ANTHROPIC_API_KEY (step marked "degraded"); scoring, routing, CSV, store (Upstash or memory + `.cache/plans`), seeds; `POST /api/plan` streams NDJSON PlanEvents; `GET /api/plan/[id]`, `/csv`
  - UI `src/components/{ui,plan}`, `/`, `/run`, `/plan/[id]`, `/plan/[id]/print`, built from the design system (screenshots were checked)
  - Map + tour `src/components/{map,tour}`, `src/lib/tour`, `/plan/[id]/tour`: MapLibre on OpenFreeMap positron recolored to tokens (mid-grey ground on the dark theme, chosen by the user 2026-10-13 from the `?ground=` presets; see UX.md), progressive route, bloom, pulse, 6 s beat sequencer with exact pause/seek, keyboard, reduced motion, finale (verified in headless Chrome, GIF recorded)
  - Mock-mode seeding works: `QLOO_MOCK=1 pnpm dlx tsx scripts/seed.ts` writes demo-musician / demo-comedian / demo-podcast to `.cache/plans`
- [x] Git repo initialised, MIT `LICENSE`, `.gitignore`, pushed to GitHub (private for now)

## In progress
- (nothing; next session picks up from "Next session starts here")

## Pending: admin (do these first, they take days to clear)
- [x] Requested Qloo hackathon API key on 2026-10-12 (expected within a day or two). Build runs with QLOO_MOCK=1 until it lands.
- [x] Join hackathon on Devpost: supplied overview PDF dated 2026-10-13 confirms registration.
- [ ] Join Qloo Discord `#api-help`: https://discord.gg/rF9PKsD5Q7
- [ ] Escalate in `#api-help` if the key has not arrived by Oct 16

## Key-day checklist (run the moment QLOO_API_KEY arrives)
Findings from building the Qloo layer against the live docs on 2026-10-12. Each needs a real response to settle.
- [ ] Put the key in `.env.local` as `QLOO_API_KEY`, set `QLOO_MOCK=0`, run `curl -N -X POST localhost:3000/api/plan -H 'content-type: application/json' -d '{"actQuery":"<real act>","stops":8}'`
- [ ] **Heatmap comparability:** per-city `filter.location.query` heatmaps may be normalized within each city (docs example tops out at exactly 1.0). If so, the quadrant chart is wrong. Compare against one regional query with `output.heatmap.boundary=urn:entity:locality`. The client notes `meta.note` when the top cell is exactly 1.
- [ ] **Compare response shape** for `/v2/analysis/compare`: overlap is computed from per-side scores if present, else "degraded" with overlap 0. Inspect a real response and fix `schemas.ts`. Checked 2026-10-12 against the official harness (`@qloo/qloo-harness` 0.1.26, `dist/qloo-tools.js` makeCompareAudiencesTool): its request is identical to ours (`a.signal.interests.entities`, `b.signal.interests.entities`, optional `filter.type`, plus `take`), and it passes `response.results` through untyped, so it reveals nothing about the body. Our defensive parser stands; a live call is still the only way to settle it.
- [ ] **Explainability JSON layout** (`query.explainability`): parsed defensively; confirm field names. It returns scores only, so the client writes the sentence itself.
- [ ] Do `signal.location.query` and `feature.explainability` change artist/person/podcast results, or are they silently ignored?
- [ ] Video game type URN: `urn:entity:videogame` on /search, /v2/trending, compare vs `urn:entity:video_game` on insights. Confirm which each endpoint accepts. Note: the harness sends the Insights URN (`video_game`) to compare, we send the search URN; identical for artist/person/podcast, so only matters if video games are enabled.
- [ ] Trending percentile scale (0–100 vs 0–1); code handles both.
- [ ] Does heatmap `take=50` cap cells?
- [ ] Demographics cannot be localized per the docs; the agent calls it without a location. Check whether a location param exists anyway.
- [ ] Comedian openers: taxonomy tag is `urn:tag:genre:person:comedian` (not occupation). Consider adding an optional `tagIds` filter to `relatedActs` in the contract.
- [ ] Gender comes back as scores vs baseline, not shares (types, fixture, UI and CSV already switched to scores on 2026-10-12).
- [ ] Test comedian, podcast and author coverage for the seeded acts (Khruangbin, Nate Bargatze, The Rest Is History; set in `src/lib/seeds.ts`, swap if thin); then flush old mock plans from Redis (`plan:demo-*` keys) so they re-seed live.

## Pending: day 0 to 2 scaffold (Oct 11 to 13)
- [x] Next.js 16.4 scaffolded (App Router, TypeScript, Tailwind v4, src/, pnpm). Note: this Next.js has breaking changes; read `AGENTS.md` and `node_modules/next/dist/docs/` before writing app code.
- [x] Installed ai, @ai-sdk/anthropic, zod, @upstash/redis, maplibre-gl, d3-scale, nanoid, vitest
- [x] `.env.example` written; `src/app/globals.css` carries the design tokens; `src/lib/types.ts` is the shared Plan schema; `src/fixtures/plan.sample.json` is the synthetic demo plan (validated by a vitest test)
- [x] Qloo client, tools, mock, city pools (see session 2 above)
- [x] **Deployed on Railway** (project `soundcheck`, services `soundcheck` + `Redis`): https://soundcheck-production-0c8e.up.railway.app . Deploy with `railway up --service soundcheck --ci`. Variables set: QLOO_MOCK=1, REDIS_URL=${{Redis.REDIS_URL}}, NODE_ENV. ANTHROPIC_API_KEY set 2026-10-12 (health reports `model: true`). SOUNDCHECK_ADMIN_TOKEN set 2026-10-12 (value in the local `.env.local`; the agent may not write Railway secrets, the user runs `railway variable set ... --service soundcheck`). Still to set: QLOO_API_KEY (then QLOO_MOCK=0). Flush a stored plan with `curl -X DELETE -H "Authorization: Bearer $TOKEN" $HOST/api/plan/demo-musician`; the next read regenerates it. `/api/health` reports backend, mode and which seeded plans are persisted. Seeded demos are generated on first request if missing (`src/lib/ensureSeed.ts`).

## Pending: week 1 musician demo (Oct 14 to 19)
- [x] Agent loop, scoring, routing, landing, plan page, map tour, persistence (session 2)
- [x] Run the agent loop with a real ANTHROPIC_API_KEY once and read the model-written `whyHere` / `suggestion` copy; tune `src/lib/agent/prompts.ts`. Done 2026-10-12 locally (mock Qloo, real model, ~30s per plan, 10 call types). First pass was one template repeated per city; fixed by rotating a `writing.leadWith` angle per stop (`leadAngle` in run.ts) and loosening the prompt. The three Railway demos were flushed and regenerated 2026-10-12 with model-written copy (mock Qloo); a live custom run on Railway (Kurt Vile, 6 stops) also completed in ~30s.
- [ ] Act search autocomplete on the landing form via `/search` (currently a plain text input)
- [ ] `/plan/<unknown>` returns 200 with not-found UI (id read inside Suspense); acceptable, or move notFound() outside the boundary
- [ ] Plan-page hover on quadrant dots flies the map (debounced 140 ms); decide whether hover should only highlight and click should fly
- [ ] Routing can include a "reach" city when few cities clear affinity 0.7 (comedian demo stop 1 was Spokane, reach); consider requiring affinity ≥ 0.6 before falling back
- [ ] Tour card "why" popovers; tile pre-warming (no MapLibre prefetch API); bloom reads as a field only once real heatmap cells arrive
- [ ] On key arrival: swap mocks for live, test comedian + podcast + author coverage, note findings here

## Pending: week 2 depth and breadth (Oct 20 to 25)
- [x] Opener comparison implemented as derived taste similarity; live semantics pending.
- [x] Sponsors (brand insights with act-wide demographic signals); live validation pending.
- [x] Activations (`/v2/tags` + place insights); live validation pending.
- [x] Explanation popovers per pick, with safe legacy wording.
- [x] Comedian and podcast synthetic seeded demos; live coverage pending.
- [x] Thin-data fallbacks and limited-data states.
- [x] Print view + CSV export, with source provenance.
- [ ] Pre-run and cache the 3 seeded demos
- [ ] Record the map tour as the Devpost hero GIF and a short video

## Pending: week 3 polish and write-up (Oct 26 to 30)
- [ ] Mobile pass, degraded states, rate-limit protection
- [x] Optional matched-brief comparison, validation and honest limitations; real evaluation pending.
- [ ] Move RESEARCH.md sections 6, 7, 10, 11 to `docs/strategy.md` (gitignored); write the public root README.md per kit submission guide
- [ ] Flip repo public: `gh repo edit --visibility public`; confirm LICENSE shows in About
- [ ] Devpost description (4 sections matching 4 criteria), screenshots, limitations
- [ ] Submit Oct 29

## Blockers
- Qloo API key requested October 12 but not yet present locally. Live semantics and user evidence remain unvalidated.

## Decisions made (do not re-litigate)
- REST API called directly from our backend, not the `qloo mcp` stdio server (see README section 4)
- Three hero demos only: musician, comedian, live podcast. Other act types marked experimental.
- Static curated city pools per region; Qloo locality search only for custom cities.
- Nearest-neighbor routing with 1 travel day between stops.
- Cost model stays at route economics (distance, days, crew, editable rates, break-even). No hotel or flight prices per city.
- Print-to-PDF via styled page, not a PDF library.
- Hosting update October 13: user requested Vercel for the web app. The Railway agent/Redis backend remains in place; Vercel forwards API requests and reads saved plans over HTTPS. No new database provider.
- Repo private until the public README is written. Devpost rules (verified 2026-10-11) require a public repo with a visible license at submission; nothing requires it public during the build.

- [x] **Act identity (2026-10-12):** the plan header and print cover show the resolved act's picture, a one-line description and "Confirm" links (Wikipedia, official site, Spotify, Apple Podcasts, YouTube, Instagram, X, IMDb). Fetched online at run time in `src/lib/actProfile.ts`: Qloo entity image / `external` ids first (live key), Wikipedia REST + Wikidata as the free fallback (works in mock mode). Cached in KV under `profile:v2:*`. Tests stub the lookup (`RunDeps.profile`). Stored plans without the fields parse fine (`links` defaults to []).

- [x] **Route economics (2026-10-12):** the plan page, print cover and CSV now carry Soundcheck's travel-cost model: road distance per leg (great-circle × 1.25), travel and crew days, a travel-and-crew estimate from per-mile and per-day rates by budget tier (van / bus / production; `PlanInput.budgetTier`, default bus, chosen under Advanced on the landing form), flight-flagged legs over the tier's overnight-drive threshold (left unpriced), and a per-city break-even (leg in + one show day against the suggested room at an assumed ticket). Rates are editable on the plan with a reset. Everything is tagged "Soundcheck estimate", never Qloo. Model in `src/lib/economics.ts` (`suggestCapacity` moved here from run.ts), UI in `src/components/plan/RouteEconomics.tsx`. Decision: no per-city hotel or flight prices, ever; there is no reliable free source and invented precision would hurt with the Live Nation judge. Stored plans without `budgetTier` parse via the zod default.

- [x] **Model cost (2026-10-12):** the user saw ~$3 after a few runs. Cause: the tool loop (14 to 22 steps per plan) resent the whole growing conversation at full price with no prompt caching, plus one copy call per stop. Fix: a top-level `cache_control` on every call (Anthropic automatic prompt caching) in `src/lib/agent/model.ts`, switchable off with `SOUNDCHECK_PROMPT_CACHE=0`, and a `UsageMeter` per run that lands in `plan.summary.model` (shown in the trace footer and the print method page). Measured on a 5-stop mock-Qloo run: without caching 111,867 input tokens all uncached; with caching 126,680 input tokens of which 97,158 were cache reads and 29,480 cache writes, so the billed-equivalent input fell by roughly 55 to 60 percent (reads bill at a tenth, writes at 1.25×). Longer plans save more. Still open if cost matters further: Haiku for the copy calls, fewer loop steps by batching city probes. Stored demos predate the meter and show no usage until regenerated.
- [x] **Map ground (2026-10-13):** the user chose the `mid` preset from the `?ground=` switch; the six `--map-*` tokens in `globals.css` and the fallbacks in `basemap.ts` now hold it (land `#534d45`, water `#1e2128`). The earlier "light" decision was made during the stale-CSS bug and is void. The switch stays as a dev aid.
- [x] **Plan revisions (2026-10-13):** a finished plan can be edited without a chat. City cards have Lock and Drop; the route strip drags to reorder (keyboard: Alt+Arrow; touch: arrow buttons on the selected stop) and recomputes travel days and economics instantly; a revise bar docked at the bottom takes one free-text request, sends it to one small model call (`POST /api/plan/[id]/propose`) that returns a change-set over the plan's controls plus a one-line reading and any unmatched cities, and shows every pending change as a removable chip. Nothing runs until "Re-run with N changes", which stores `{ parentId, changes }` for `/run`. `POST /api/plan` accepts a `RevisionRequest`; the server applies the change-set to the parent's input (`src/lib/revision.ts`) and runs it as a new plan id with `parentId`, `revision` and `revisionNote`; the parent is never written. A reorder-only change is a clone of the parent with recomputed legs (no Qloo, no model, ~20 ms). A full revision skips the model's agent loop: the act is carried over, the parent's candidates are re-probed from the Qloo cache, picks are seeded from the parent, and city copy is reused for stops whose previous city and leg days did not change (the model writes copy only for new or moved stops). Header shows "Revision n, from revision n-1" with a link back; print cover carries the line. Verified locally against mock Qloo with no model: drop + lock + fewer stops reused 4 of 9 copies. One measured propose call ("swap Boise for Phoenix and make it 9 stops"): 1,389 input tokens, 91 output, 3.5 s, correct change-set. Gotcha: Anthropic structured outputs require every property, so the proposal's optional controls are nullable on the wire (`RevisionDraftWire` in model.ts) and mapped to undefined. 150 tests. Not yet verified by hand in a browser: drag, chips and the bar.
- [x] **Map fallback flake fixed (2026-10-13):** the plan page intermittently showed the list fallback instead of the map. Cause: `hasWebGL()` was the getSnapshot of a `useSyncExternalStore`, so React ran it on every render and each run created a WebGL context it never released. Chrome caps live contexts at about 16 per page and evicts the oldest, which was the map's own canvas: `webglcontextlost` fired, the 3 s timer gave up, and `failed` stuck. Now probed once per page and the probe context is released with `WEBGL_lose_context`; the fallback has a "Load map again" link that re-runs the build effect. Follow-up worth doing: a drag reorder changes `dataKey` and rebuilds the whole map; updating the route and marker sources in place would avoid the teardown and the 400 ms fade.
- [x] **Landing redesign (2026-10-13):** the user did not see a map on `/` (there was none, only SVG sketches, two of them random lines). Now: real map in the hero (`PlanMap` `mode="hero"`: route drawn, markers on, no controls, non-interactive, 40 s push-in; `RouteSketch` fallback without WebGL), streamed in after a prerendered sketch via `connection()` + `getPlan` (reads only, never generates). Demo cards draw from the stored plans with a "Primed, untapped: …" line; a missing plan says so. Added a three-step how-it-works, tour-manager copy, nav with anchors, the form under its own heading. `src/components/landing/{LandingMap,HeroMap,DemoCards}.tsx`. UX.md screen 1 rewritten. Verified by curl locally and live; not hand-checked in a browser (extension not connected).

- **Build cache gotcha (2026-10-12):** Turbopack's build filesystem cache served a stale `globals.css` chunk after a token-only change, both locally and on Railway (which persists `.next/cache`). `experimental.turbopackFileSystemCacheForBuild` is now `false` in `next.config.ts`. If a CSS change ever fails to show up on the live site, check the served chunk's values with curl before anything else.

## Open questions
- Seeded acts chosen 2026-10-12: Khruangbin (artist, North America), Nate Bargatze (comedian, North America), The Rest Is History (podcast, UK and Ireland). Revisit on key day if coverage is thin.
- KV choice: Upstash Redis (Marketplace) vs Vercel KV. Pick whichever provisions fastest.

## Next session starts here
1. Read the session 4 entry and `docs/VALIDATION.md`. Do not rebuild already-implemented features from historical unchecked lists.
2. If the Qloo key has arrived: run the live-data gate and key-day checklist first. Otherwise keep synthetic labels and do not claim geographic validation.
3. Ask the user to try the revision controls in a browser (drag a stop, Drop and Lock a card, type a request into the revise bar, Re-run) and fix whatever they report. Open questions: should Drop shrink the tour instead of replacing the city; should a city-set change keep the hand order as a backbone rather than discarding it.
4. Week 1 list: act autocomplete, the small UI issues above. Copy quality: "1x the pool's median" reads oddly for reach cities; consider rounding language or a different lead for the reach quadrant.
5. Update this file before ending the session.
