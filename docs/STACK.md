# Soundcheck engineering stack

Choices and the reasoning behind each. Optimised for one builder shipping a judge-ready product in 19 days on Vercel. Verify exact package versions at scaffold time; do not pin from memory.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Framework | **Next.js (App Router) + TypeScript**, Node 22 LTS, pnpm | UI, streaming API routes, and server-only secrets in one deploy. Vercel-native. | Separate Flask/Express backend (prior winner GeoTaste did this): second deploy surface, no benefit here |
| Agent runtime | **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`) with `streamText` + tools, step limit via `stopWhen`, typed tool schemas with zod | Tool calling, streaming, and structured output in one library. Model swap is one line. Streams tool calls to the UI for the agent trace rail. | LangGraph (heavier than needed), Google ADK (used by a prior winner, no edge), hand-rolled ReAct (more code, same result) |
| Model | **`claude-sonnet-5-5`** for dev and custom runs; evaluate **`claude-opus-5-5`** for the three seeded demos | Sonnet is fast and cheap for the many-tool loop; Opus for the best "why this city" prose on cached demos. Confirm IDs and pricing with the `claude-api` skill before wiring. | GPT/Gemini: no reason to switch given the AI SDK abstracts it anyway |
| Qloo access | **Hand-written typed REST client** (`lib/qloo/client.ts`) + one zod schema per response shape | No REST SDK exists; the official harness is CLI/MCP only and cannot run on Vercel (stdio). Typed client gives full access to heatmap, trending, compare, explainability. | `qloo mcp` via child process (needs a long-lived server, not serverless) |
| Tool envelope | `{ status: ok \| empty \| partial \| degraded \| error, data, meta }` | Mirrors the harness envelope so thin hackathon data degrades gracefully; the agent reads `status` and chooses fallbacks. | Throwing on empty results (kills the run) |
| Storage | **Upstash Redis** via Vercel Marketplace (`@upstash/redis`) | One store for the Qloo cache (key = full request URL, no TTL) and saved plans (key = plan id, JSON). Zero schema, provisions in a minute, free tier is enough. | Postgres/Supabase (schema and migration overhead for a 19-day build), Vercel Blob (no key lookup ergonomics) |
| Styling | **Tailwind CSS** + **shadcn/ui** primitives, custom design tokens for the dark stage theme | Fast, consistent, accessible primitives; tokens keep the theme coherent. Fonts: a condensed display face for headings, a neutral sans with tabular numerals for body and scores. | Custom CSS from scratch (slow), MUI/Chakra (fights the custom look) |
| Map | **MapLibre GL JS** with a free vector basemap (OpenFreeMap or a Protomaps/CARTO dark style) | Free, no token, dark basemap matches the theme, GeoJSON layers for heatmap points and route line. | Mapbox (token + billing), Leaflet (raster, less polished) |
| Map tour motion | **MapLibre camera API** (`flyTo`, `fitBounds`, `easeTo`) plus a small `requestAnimationFrame` sequencer; route drawn progressively by `setData` on a GeoJSON source with a hand-written `lineSliceAlong`; card and chrome animations in CSS transitions keyed off a `data-phase` attribute | No animation library needed; MapLibre's camera easing is already good, and CSS handles the card. Keeps bundle small and reduced-motion trivial. | framer-motion (fine, but adds weight for three transitions), GSAP (licence noise), deck.gl (overkill for a few hundred points) |
| Quadrant chart | **Hand-rolled SVG** with `d3-scale` for axes | A 2x2 scatter is 60 lines; full control over the highlighted quadrant and hover linking to map pins. | Recharts/Chart.js (harder to style the signature visual exactly) |
| Audience bars | Plain divs with widths from demographics scores | Trivial, no dependency. | Chart library |
| Validation | **zod** everywhere: form inputs, tool inputs, Qloo responses | One schema language shared by the AI SDK tools and the API client. | Manual type guards |
| Routing algorithm | `lib/routing.ts`: nearest-neighbour from the first locked city, 1 travel day per leg, optional 2-opt | Deterministic, instant, good enough for a demo. Lat/lon from the curated city pools. | Real TSP solver or routing API (overkill) |
| Export | **Print-styled route** + `window.print()` for PDF; **route handler** for CSV | Zero dependencies, zero rendering bugs. | `@react-pdf/renderer`, Playwright PDF (time sinks) |
| IDs | `nanoid` for plan ids | Short shareable URLs. | UUID (long URLs) |
| Testing | **vitest** for `score.ts`, `routing.ts`, CSV encoding, status-envelope mapping | Cheap confidence on the pure logic. | Playwright e2e (skip; manual judge-simulation instead) |
| Lint/format | create-next-app defaults (ESLint + Prettier) | No yak shaving. | Biome (fine, but not worth the switch) |
| Hosting | **Vercel**, Fluid compute, `maxDuration` set on the agent route | Streaming works out of the box; env vars hold the keys. **Check plan limits on function duration.** The agent run must finish inside the limit; each tool result is cached so a retry resumes instantly. Fallback if limits bite: drive the loop from the client, one agent step per request. | Railway/Fly (only needed if we adopt `qloo mcp`) |
| Secrets | Vercel env vars: `QLOO_API_KEY`, `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL/TOKEN`; `QLOO_MOCK=1` for fixtures; `.env.example` committed with placeholders | Keys never reach the client or the repo. | |
| Mock layer | `lib/qloo/mock.ts` returns hand-written synthetic fixtures matching documented shapes | Lets the whole app be built before the key arrives; also the CI-safe mode. Never store real Qloo responses in the repo. | Recording real responses as fixtures (violates the Qloo terms) |
| Observability | Vercel logs + AI SDK `onStepFinish` logging of tool name, status, duration | Enough to debug the loop and to count call types for the write-up. | Langfuse/OTel (later, if ever) |

## Request flow

1. Client `POST /api/plan` with `{ actId, actType, region, stops, window, locked, excluded }` (zod-validated).
2. Route handler runs `streamText` with the tool set. Each tool calls the Qloo client, which checks Redis by URL, else fetches `https://hackathon.api.qloo.com` with `X-Api-Key`, stores the result, and returns the envelope.
3. Tool calls and partial results stream to the client as UI messages; the trace rail and skeletons update live.
4. On finish the handler assembles the plan JSON (cities, scores, route, openers, sponsors, places, explanations, trace) and writes it to Redis under a `nanoid`. Client navigates to `/plan/[id]`.
5. `/plan/[id]` is a server component reading Redis. Seeded demos are just pre-written plan ids.

## Dependencies to install at scaffold

```
pnpm add ai @ai-sdk/anthropic zod @upstash/redis maplibre-gl d3-scale nanoid
pnpm add -D vitest @types/d3-scale
pnpm dlx shadcn@latest init
```
