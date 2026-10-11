# STATUS

Session handoff tracker for Soundcheck. Update this file at the end of every session so the next agent can start cold.
Read order for a new session: `docs/RESEARCH.md` (research + API mapping) → `docs/PLAN.md` (strategy, architecture, schedule) → `docs/UX.md` (screens and visual direction) → `docs/STACK.md` (stack choices) → this file.

**Deadline:** Oct 30, 2026, 11:45 pm ET. Submit by Oct 29.

## Last updated
2026-10-12 (session 2)

## Done
- [x] Research handoff written (`docs/RESEARCH.md`)
- [x] Build plan written (`docs/PLAN.md` + `docs/UX.md` + `docs/STACK.md`): strategy changes, UI screens, architecture, 19-day schedule, verification
- [x] Soundcheck Design System published (Claude Design artifact): tokens for Stage/Print themes, brand book, 13 components incl. animated TourCard, TourControls, MotionPrimitives, plus a Motion section in the brand book. Link in `docs/UX.md`.
- [x] Map tour (presentation mode) and app-wide motion specified in `docs/UX.md` screen 4 and the Motion section
- [x] Git repo initialised, MIT `LICENSE`, `.gitignore`, pushed to GitHub (private for now)

## In progress (session 2, four parallel agents, disjoint ownership)
- Qloo tool layer (`src/lib/qloo/**`, `src/data/cities/**`) built from the live hackathon docs; mock client for QLOO_MOCK=1
- Agent loop + API (`src/lib/agent/**`, `src/lib/score.ts`, `src/lib/routing.ts`, `src/lib/store.ts`, `src/lib/csv.ts`, `src/lib/seeds.ts`, `src/app/api/**`, `scripts/seed.ts`)
- UI shell (`src/components/ui`, `src/components/plan`, `src/app/page.tsx`, `src/app/run`, `src/app/plan/[id]/page.tsx`, print view)
- Map + tour (`src/components/map/**`, `src/components/tour/**`, `src/lib/tour/**`, `src/app/plan/[id]/tour`)
- Cross-workstream contracts: `src/lib/qloo/contract.ts`, `src/lib/store.ts` exports, `src/components/map/PlanMap.tsx` props, `PlanEvent` NDJSON stream from POST /api/plan

## Pending: admin (do these first, they take days to clear)
- [x] Requested Qloo hackathon API key on 2026-10-12 (expected within a day or two). Build runs with QLOO_MOCK=1 until it lands.
- [ ] Join hackathon on Devpost: https://qloo.devpost.com/
- [ ] Join Qloo Discord `#api-help`: https://discord.gg/rF9PKsD5Q7
- [ ] Escalate in `#api-help` if the key has not arrived by Oct 16

## Key-day checklist (run the moment QLOO_API_KEY arrives)
Findings from building the Qloo layer against the live docs on 2026-10-12. Each needs a real response to settle.
- [ ] Put the key in `.env.local` as `QLOO_API_KEY`, set `QLOO_MOCK=0`, run `curl -N -X POST localhost:3000/api/plan -H 'content-type: application/json' -d '{"actQuery":"<real act>","stops":8}'`
- [ ] **Heatmap comparability:** per-city `filter.location.query` heatmaps may be normalized within each city (docs example tops out at exactly 1.0). If so, the quadrant chart is wrong. Compare against one regional query with `output.heatmap.boundary=urn:entity:locality`. The client notes `meta.note` when the top cell is exactly 1.
- [ ] **Compare response shape** for `/v2/analysis/compare`: overlap is computed from per-side scores if present, else "degraded" with overlap 0. Inspect a real response and fix `schemas.ts`.
- [ ] **Explainability JSON layout** (`query.explainability`): parsed defensively; confirm field names. It returns scores only, so the client writes the sentence itself.
- [ ] Do `signal.location.query` and `feature.explainability` change artist/person/podcast results, or are they silently ignored?
- [ ] Video game type URN: `urn:entity:videogame` on /search, /v2/trending, compare vs `urn:entity:video_game` on insights. Confirm which each endpoint accepts.
- [ ] Trending percentile scale (0–100 vs 0–1); code handles both.
- [ ] Does heatmap `take=50` cap cells?
- [ ] Demographics cannot be localized per the docs; the agent calls it without a location. Check whether a location param exists anyway.
- [ ] Comedian openers: taxonomy tag is `urn:tag:genre:person:comedian` (not occupation). Consider adding an optional `tagIds` filter to `relatedActs` in the contract.
- [ ] Gender comes back as scores vs baseline, not shares (types, fixture, UI and CSV already switched to scores on 2026-10-12).
- [ ] Test comedian, podcast and author coverage; pick the three real seeded acts; run `QLOO_MOCK=0 pnpm dlx tsx scripts/seed.ts`.

## Pending: day 0 to 2 scaffold (Oct 11 to 13)
- [x] Next.js 16.4 scaffolded (App Router, TypeScript, Tailwind v4, src/, pnpm). Note: this Next.js has breaking changes; read `AGENTS.md` and `node_modules/next/dist/docs/` before writing app code.
- [x] Installed ai, @ai-sdk/anthropic, zod, @upstash/redis, maplibre-gl, d3-scale, nanoid, vitest
- [x] `.env.example` written; `src/app/globals.css` carries the design tokens; `src/lib/types.ts` is the shared Plan schema; `src/fixtures/plan.sample.json` is the synthetic demo plan (validated by a vitest test)
- [ ] `lib/qloo/client.ts` (base URL `https://hackathon.api.qloo.com`, `X-Api-Key`, retry, cache by URL)
- [ ] `lib/qloo/tools/*.ts` typed tools with `{ status: ok|empty|partial|degraded|error, data, meta }` envelope
- [ ] `lib/qloo/mock.ts` synthetic fixtures (hand-written shapes only, never real Qloo responses)
- [ ] `data/cities/{na,uk-ie,eu}.json` curated metro pools with lat/lon
- [ ] Vercel project linked, env vars set, first deploy

## Pending: week 1 musician demo (Oct 14 to 19)
- [ ] Agent loop (`lib/agent/run.ts`) with step guard and coverage checklist, streaming to UI
- [ ] Heatmap scoring over city pool, `lib/score.ts` underserved score
- [ ] Demographics, trending, routing (`lib/routing.ts`)
- [ ] Landing page with 3 seeded demo cards + custom form
- [ ] Plan page: map, quadrant chart, route strip, city cards, agent trace rail
- [ ] Map tour page (`/plan/[id]/tour`): sequencer, progressive route, heatmap bloom, TourCard, TourControls, keyboard, reduced motion
- [ ] Shareable `/plan/[id]` persistence
- [ ] On key arrival: swap mocks for live, test comedian + podcast + author coverage, note findings here

## Pending: week 2 depth and breadth (Oct 20 to 25)
- [ ] Openers with `/v2/analysis/compare` overlap
- [ ] Sponsors (brand insights with demographic signals)
- [ ] Activations (`/v2/tags` + place insights)
- [ ] Explainability popovers per pick
- [ ] Comedian and podcast seeded demos
- [ ] Thin-data fallbacks (tag-seeded) and "Limited Qloo data" UI state
- [ ] Print view + CSV export
- [ ] Pre-run and cache the 3 seeded demos
- [ ] Record the map tour as the Devpost hero GIF and a short video

## Pending: week 3 polish and write-up (Oct 26 to 30)
- [ ] Mobile pass, degraded states, rate-limit protection
- [ ] "Without Qloo" side-by-side toggle (stretch)
- [ ] Move RESEARCH.md sections 6, 7, 10, 11 to `docs/strategy.md` (gitignored); write the public root README.md per kit submission guide
- [ ] Flip repo public: `gh repo edit --visibility public`; confirm LICENSE shows in About
- [ ] Devpost description (4 sections matching 4 criteria), screenshots, limitations
- [ ] Submit Oct 29

## Blockers
- Qloo API key not yet requested/received. Build mock-first.

## Decisions made (do not re-litigate)
- REST API called directly from our backend, not the `qloo mcp` stdio server (see README section 4)
- Three hero demos only: musician, comedian, live podcast. Other act types marked experimental.
- Static curated city pools per region; Qloo locality search only for custom cities.
- Nearest-neighbor routing with 1 travel day between stops.
- Print-to-PDF via styled page, not a PDF library.
- Repo private until the public README is written. Devpost rules (verified 2026-10-11) require a public repo with a visible license at submission; nothing requires it public during the build.

## Open questions
- Which three specific acts to seed? Pick acts with large, well-documented fanbases so Qloo data is deep. Decide on key day after checking coverage.
- KV choice: Upstash Redis (Marketplace) vs Vercel KV. Pick whichever provisions fastest.

## Next session starts here
1. Do the admin checklist above (key, Devpost, Discord).
2. Optional: Design canvas artboards (plan page, landing, city card) built on the design system, for the user to approve the look before code.
3. Scaffold Next.js and the mock tool layer (day 0 to 2 list); pull tokens from the design system into Tailwind theme config.
3. Update this file before ending the session.
