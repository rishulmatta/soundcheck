# Soundcheck build plan (optimized for the Qloo Agentic Hackathon)

## Context

`docs/RESEARCH.md` (the original README) is a research handoff (dated today, 2026-10-11) for Soundcheck, a tour-planning agent built on the Qloo API. Nothing is built yet. The deadline is Oct 30, 2026, 11:45 pm ET, so there are 19 days. The user asked to optimize the project for winning. Winning means scoring on four equally weighted criteria (Qloo depth, design completeness, impact, idea quality) with ties broken on Qloo depth, and passing a pass/fail gate on "would this work without Qloo". Judges may rely on the write-up and automated AI analysis instead of testing the demo.

This plan does two things: (1) adjusts the README's strategy where it leaves points on the table, and (2) lays out the build in an order that produces a judge-ready product even if time runs out.

## Assumptions (stated, not confirmed)

- Solo builder, part-time, ~19 days. Scope is cut accordingly.
- Qloo hackathon key has not arrived yet (README checklist is unchecked). Everything is built mock-first.
- Stack follows the README proposal: Next.js App Router + TypeScript on Vercel, Vercel AI SDK tool calling with Claude (`claude-sonnet-5-5` for dev, evaluate `claude-opus-5-5` for the final demos). Confirm model IDs and pricing with the `claude-api` skill at implementation time.

## Immediate actions this session (user requested)

1. **Copy this plan into the repo** as `docs/PLAN.md` with the UI section split into `docs/UX.md`.
2. **Create `docs/STATUS.md`**: a handoff tracker with "Done / In progress / Pending / Blockers / Next session starts here" sections, updated at the end of every session so the next agent can pick up cold. Seed it with the admin checklist (API key, Devpost, Discord, license) and the day-0 scaffold tasks.
3. **Initialise git and push to GitHub.** `git init`, add `.gitignore` (node, `.env*`, `docs/strategy.md`), MIT `LICENSE`, commit, then `gh repo create soundcheck --source . --push`. Check `gh auth status` first.
   - Create the repo **private for now** and flip it public before submission. The research doc carries judge-targeting notes and competitive intel that should not be public (strategy item 7 below). Making it public is a one-line `gh repo edit --visibility public` later.
   - Devpost requires the license to show in the GitHub About section. GitHub detects a root `LICENSE` file automatically.
4. Keep `docs/RESEARCH.md` as is for this session. The split into a public README plus private `docs/strategy.md` happens before going public.

## Strategy changes (what the README's plan should do differently)

1. **Three hero demos, mapped to judges. Not six act types.**
   Musician (Live Nation EVP), comedian (Cedric the Entertainer), live podcast (Calacanis). Keep the act-type selector but mark author/esports/brand as "experimental" and only enable them if the dataset proves out on key day. Three polished demos beat six thin ones on the Design criterion.

2. **Make "primed but untapped" the signature visual.**
   The non-obvious insight is cities with high Qloo affinity and low popularity for the act. Render it as a 2x2 quadrant (x = popularity, y = affinity, each city a dot, the top-left quadrant highlighted and labelled "Primed, untapped"). This answers README open question 3 and gives judges a single image that proves the idea. Every city card restates its quadrant in one sentence.

3. **Make Qloo depth auditable, not just present.**
   Target at least 10 distinct call types, each visible in the agent trace with redacted params: `/search`, `/v2/tags`, insights with `filter.type` = heatmap, demographics, artist/person/podcast, brand, place, tag; `/v2/trending`; `/v2/analysis/compare`; plus `feature.explainability`, weighted `signal.interests.entities`, `diversify.by`, `filter.exclude.entities`. The write-up includes a table of every call type with the question it answers. The tiebreaker criterion is won here.

4. **Agentic for real, but never fragile.**
   The LLM decides: which cities from the pool to probe, when to fall back to genre/occupation tag seeds when an entity is thin, which `/v2/tags` IDs fit a venue brief, and how to resolve ambiguous act names. A deterministic guard wraps it: max steps, a required-coverage checklist (the plan is not "complete" until heatmap, demographics, openers, sponsors, places all ran), and a status envelope (`ok/empty/partial/degraded/error`) per tool mirrored from the harness. Seeded demos are pre-run and replayed from cache so judge clicks never hit 429s or empty data.

5. **Judges leave with an artifact without running anything.**
   Every plan gets a shareable URL (`/plan/[id]`) persisted server-side. The three seeded demos ship as permanent links placed at the top of the Devpost description. Export is print-styled HTML to PDF plus CSV. Skip `@react-pdf/renderer` and Playwright; they are time sinks.

6. **"Without Qloo" toggle (cheap stretch, high leverage).**
   One extra LLM call producing a plain-LLM tour plan for the same inputs, shown side by side with Soundcheck's. Directly answers the hackathon's pass/fail test and the Idea criterion. Build only after items 1 to 5 are done.

7. **Write the public README before the repo goes public.**
   `docs/RESEARCH.md` contains judge-targeting notes and competitive intelligence. Judges may read the repo. Move sections 6, 7, 10, 11 to a private `docs/strategy.md` (gitignored) and rewrite the public README as the kit's submission guide asks: problem, Qloo workflows used and why, redacted request-to-result walkthrough, clean-environment setup, screenshots, limitations.

8. **Reserve the last 3 days for the write-up.** Judges may never click the demo. Devpost description structured as four headed sections matching the four criteria, with the quadrant screenshot first.

## UI design

See `docs/UX.md` for the screen-by-screen layouts, visual direction, and print/export views.

## Architecture

Stack choices with rationale live in `docs/STACK.md`. File layout:

```
app/
  page.tsx                    landing: 3 seeded demos, one click each, plus custom form
  plan/[id]/page.tsx          saved plan: map, quadrant, city cards, trace, export buttons
  plan/[id]/tour/page.tsx     map tour: full-bleed map, auto-cycling stops (docs/UX.md screen 4)
  plan/[id]/print/page.tsx    print-styled view for PDF
  api/plan/route.ts           streaming agent run (AI SDK), writes plan on completion
  api/plan/[id]/csv/route.ts  CSV export
lib/
  qloo/client.ts              fetch wrapper: base URL https://hackathon.api.qloo.com, X-Api-Key, retry, cache
  qloo/tools/*.ts             one typed tool per call type, each returns { status, data, meta }
  qloo/mock.ts                synthetic fixtures (hand-written shapes, never real Qloo data)
  agent/run.ts                planner loop, step guard, coverage checklist
  agent/prompts.ts            system prompt incl. safe-use rules
  routing.ts                  nearest-neighbor over lat/lon with travel-day gaps
  tour/sequencer.ts           per-stop timeline (fly, draw leg, bloom, card, hold), pause/seek, reduced-motion
  tour/geo.ts                 lineSliceAlong for progressive route drawing, no turf dependency
  score.ts                    underserved score = f(affinity_rank, popularity)
data/cities/{na,uk-ie,eu}.json  curated metro pools with lat/lon (~40 / ~15 / ~25)
```

- Cache and plan storage: one key-value store (Upstash Redis via Vercel Marketplace, or Vercel KV). Qloo responses cached by full URL, indefinitely. Plans stored as JSON by id.
- Map: MapLibre GL with a free tile source. Heatmap grid points from `results.heatmap[].location`.
- Secrets: `QLOO_API_KEY`, `ANTHROPIC_API_KEY` in Vercel env only. `.env.example` with placeholders. `QLOO_MOCK=1` switches to fixtures.

## Decisions on README open questions

- **City pool:** static curated lists per region with lat/lon. Qloo locality `/search` only for user-typed custom cities. Bounded calls, deterministic routing, no surprises.
- **Routing:** nearest-neighbor from the first locked city, 1 travel day between stops, 2-opt pass if cheap. Enough for a demo.
- **Underserved presentation:** the quadrant (strategy item 2).
- **Sports clubs as brands:** test on key day, out of v1.

## Build schedule

**Days 0 to 2 (Oct 11 to 13): admin and scaffold**
- Request the Qloo key, join Devpost and Discord, create the public repo `soundcheck` with MIT LICENSE. Verify license shows in GitHub About.
- Scaffold Next.js, AI SDK, MapLibre, KV. Write `lib/qloo/tools` types from the documented shapes and the mock layer. Commit city pools.

**Days 3 to 8 (Oct 14 to 19): musician demo end to end**
- Qloo client with cache and status envelopes. Agent loop streaming steps to the UI.
- Heatmap scoring over the pool, demographics, trending, routing, map, city cards, quadrant chart.
- Map tour (screen 4) on the musician demo: flyTo sequencing, progressive route, heatmap bloom, tour card. This is what the Devpost hero GIF is cut from.
- Shareable plan URL. This is the minimum submittable product. Swap mocks for live calls the day the key arrives and test podcast and comedian coverage that same day.

**Days 9 to 14 (Oct 20 to 25): depth and breadth**
- Openers with `/v2/analysis/compare` overlap scores, sponsors with demographic signals, local activations via `/v2/tags` + place insights, explainability panel per pick.
- Comedian and podcast demos. Thin-data fallbacks (seed by tags). Exports (print view, CSV).
- Pre-run and cache the three seeded demos.

**Days 15 to 19 (Oct 26 to 30): polish and write-up**
- Mobile pass, degraded-state UI, rate-limit protection, "without Qloo" toggle if time allows.
- Write public README, move strategy notes private (strategy item 7), screenshots, Devpost description, limitations section.
- Submit Oct 29. Do not touch anything after.

## Verification

- Fresh clone + `.env.example` + `QLOO_MOCK=1` runs all three seeded demos locally with no key.
- Live deploy: each seeded link loads in under 3 seconds from cache and shows the full trace.
- Map tour: a 12-stop seeded tour runs end to end without a dropped frame on a mid-range laptop, keyboard controls work, reduced-motion mode is checked once.
- Trace audit: a seeded musician plan shows at least 10 distinct Qloo call types with status `ok`.
- Thin-data test: run an obscure act and confirm the UI shows "limited data" states, not errors, and the agent falls back to tag seeds.
- Quota test: 20 consecutive custom runs do not produce 429s thanks to caching.
- Judge simulation: someone unfamiliar opens the Devpost page, understands the quadrant in under a minute, and reaches an exported CSV without instructions.
- Repo check: no Qloo response data or keys in git history, LICENSE visible in About, README matches the kit's submission guide.

## Top risks

| Risk | Mitigation |
|---|---|
| Key arrives after Oct 20 | Mock-first build keeps everything on schedule; escalate in `#api-help` on day 5 if silent |
| Comedian or podcast data is thin | Keep music as the hero; tag-seeded fallbacks; honest "limited data" labels; still show the UI generalizing |
| Agent loop flaky in live demos | Seeded demos replay from cache; custom runs have step guards and degraded states |
