# STATUS

Session handoff tracker for Soundcheck. Update this file at the end of every session so the next agent can start cold.
Read order for a new session: `docs/RESEARCH.md` (research + API mapping) → `docs/PLAN.md` (strategy, architecture, schedule) → `docs/UX.md` (screens and visual direction) → `docs/STACK.md` (stack choices) → this file.

**Deadline:** Oct 30, 2026, 11:45 pm ET. Submit by Oct 29.

## Last updated
2026-10-12 (session 2)

## Done
- [x] Research handoff written (`docs/RESEARCH.md`)
- [x] Build plan written (`docs/PLAN.md` + `docs/UX.md` + `docs/STACK.md`): strategy changes, UI screens, architecture, 19-day schedule, verification
- [x] Soundcheck Design System published (Claude Design artifact): tokens for Stage/Print themes, brand book, 10 components, cover. Link in `docs/UX.md`.
- [x] Git repo initialised, MIT `LICENSE`, `.gitignore`, pushed to GitHub (private for now)

## In progress
- (nothing)

## Pending: admin (do these first, they take days to clear)
- [ ] Request Qloo hackathon API key: https://forms.gle/zz12orkLHTAneLGz6
- [ ] Join hackathon on Devpost: https://qloo.devpost.com/
- [ ] Join Qloo Discord `#api-help`: https://discord.gg/rF9PKsD5Q7
- [ ] Escalate in `#api-help` if the key has not arrived by Oct 16

## Pending: day 0 to 2 scaffold (Oct 11 to 13)
- [ ] `npx create-next-app@latest` (App Router, TypeScript, Tailwind) in this directory
- [ ] Install `ai`, `@ai-sdk/anthropic`, `maplibre-gl`, KV client (Upstash Redis via Vercel Marketplace or Vercel KV)
- [ ] `.env.example` with `QLOO_API_KEY`, `ANTHROPIC_API_KEY`, `QLOO_MOCK=1`
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
