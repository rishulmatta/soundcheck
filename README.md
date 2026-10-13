# Soundcheck

**Tour research for independent artist managers, grounded in cultural taste.**

Soundcheck turns an act and a touring brief into candidate cities, a route, potential support acts, sponsor candidates, and local activations. Managers can inspect evidence, lock or drop cities, revise the route, and export a planning brief before contacting venues.

[Open the app](https://soundcheck-production-0c8e.up.railway.app) · [Musician example](https://soundcheck-production-0c8e.up.railway.app/plan/demo-musician) · [Demo script](docs/DEMO.md)

**Evidence status:** development and published examples have used synthetic Qloo fixtures while the API key is pending. They demonstrate the workflow, not real market findings. Plans display source provenance; unrecorded legacy provenance is treated conservatively. Live geographic comparability and user usefulness have not been validated.

## Try it

1. Open the musician example without signing in; read its source banner.
2. Inspect a candidate city, provisional affinity/popularity chart, and redacted tool notes.
3. Review potential openers, brands, and activations. Taste similarity is not shared-fan percentage; availability and commercial interest are not checked.
4. Lock, drop, or reorder stops. A natural-language request proposes changes for review before a new plan runs; the original stays available.
5. Review editable travel/crew assumptions and export CSV or print to PDF.

The primary experience is musician tour research. Comedian and podcast examples demonstrate additional entity types whose live coverage still needs verification.

## What Qloo contributes

| Planning question | Qloo workflow | Interpretation and limits |
| --- | --- | --- |
| Which act? | Entity search | Resolve identity; ambiguity can require external confirmation. |
| What tastes? | Taste tags and tag search | Support interpretation and sparse-data fallback. |
| Which markets? | Geographic heatmaps | Cross-query comparability and aggregation need validation; rankings are provisional. |
| Which audience? | Demographics and trending | Act-wide audience profile and momentum, not city-specific demand. |
| Which support acts? | Related entities and comparison | Derived taste similarity, not shared-fan percentage. |
| Which partners? | Brand and place insights | Cultural-fit candidates, not confirmed interest or available venues. |

The model chooses tools and candidates; a deterministic coverage guard fills missing steps and marks degraded data. Routing, market labels, room assumptions, and economics are Soundcheck interpretations.

### Request to decision

Illustrative request shape, **not a recorded live finding**:

```text
GET /v2/insights?filter.type=urn:heatmap
  &signal.interests.entities=<resolved-act-id>
  &filter.location.query=<candidate-city>
```

The adapter parses cells and retains warnings. Soundcheck currently aggregates the ten highest-affinity cells, calculates a provisional heuristic score, and selects cities subject to locks and exclusions. Routing adds geographic travel estimates. Sparse direct signals may trigger a visible tag-seeded fallback. Low popularity does not establish that an act has never played a city.

Before making a validated case study, complete the [live-data checks](docs/VALIDATION.md) and record a permitted, redacted request-to-decision account. Raw Qloo responses stay in private server storage, outside Git.

## Run locally

Requires Node 22+ and pnpm (version in `package.json`).

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

The copied configuration uses synthetic Qloo data without a paid model. `/plan/demo-musician` has a bundled synthetic fallback; `/run?demo=1` replays a fixture, not a new agent run. Pre-run all examples without model charges:

```sh
QLOO_MOCK=1 ANTHROPIC_API_KEY= pnpm seed
```

With `ANTHROPIC_API_KEY`, new runs use model tool calling and incur provider usage. Without it, the deterministic orchestrator runs and marks the model step degraded.

Set `QLOO_API_KEY` and `QLOO_MOCK=0` for real calls. Confirm `/api/health`, validate responses, then explicitly regenerate examples. Old saved examples do not become live automatically. `pnpm seed demo-musician` replaces that example; preserve any needed copy first.

### Optional comparison

`SOUNDCHECK_WITHOUT_QLOO=1` adds one model call to new plans. It receives the same brief and city constraints; invalid results are omitted. This is an illustrative comparison, not a controlled benchmark: tool access, call count, and inference budget differ. Revised briefs must not reuse stale comparisons. Follow the [evaluation protocol](docs/VALIDATION.md) before claiming better outcomes.

## Deploy

The web app can run on Vercel while the agent API and Redis remain on Railway. Set `SOUNDCHECK_BACKEND_URL` to the Railway HTTPS origin on Vercel only; API requests are forwarded and server-rendered pages read the same persisted plans. Keep this variable unset on Railway to avoid a proxy loop. No model keys or public database access are needed in the Vercel project.

Vercel uses `vercel.json` to select Next.js. Set `ENABLE_EXPERIMENTAL_COREPACK=1` in Vercel so installation follows the pinned `packageManager`, then run `pnpm dlx vercel --prod`. Deploy the Railway backend before the web frontend when API behavior changes.

Railway: `railway up --service soundcheck --ci`. Variables: `REDIS_URL=${{Redis.REDIS_URL}}`, `QLOO_API_KEY`, `QLOO_MOCK`, `ANTHROPIC_API_KEY`. `/api/health` reports the active backend without secrets. Without Redis, development uses memory and `.cache/plans`.

Custom plans are limited per app instance to 2 concurrent runs and 20 starts per 15 minutes; proposals have separate limits. Adjust `SOUNDCHECK_PLAN_CONCURRENCY` and `SOUNDCHECK_PLAN_STARTS` as needed. Saved-plan reads remain available. Limits reset on restart and are not a distributed quota or provider spending cap.

## Limitations and verification

- Geographic normalization and real response semantics need actual Qloo validation; stub tests cannot establish them.
- Affinity is not ticket demand or booking history. Market labels and thresholds are exploratory heuristics.
- Room size and announcement timing are assumptions. Tickets-to-cover describes modeled travel/crew costs, not full show break-even; venue hire, act fees, hotels, and flights are not fully priced.
- Routing uses curated city pools and geographic approximations. Budget tier changes cost assumptions, not optimization constraints. The date window is a brief, not an availability-checked schedule.
- Similarity is not shared-fan percentage. Demographics and momentum are act-wide.
- No measured ticket-sales uplift, customer adoption, or recommendation-quality advantage is claimed.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Tests use synthetic data; separate live-data, browser, and user checks are in [VALIDATION.md](docs/VALIDATION.md).

## Docs

| File | What it is |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | Session handoff tracker. Start here. |
| [`docs/DEMO.md`](docs/DEMO.md) | Demonstration and submission draft |
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | Live-data gates and user evaluation |
| [`docs/UX.md`](docs/UX.md) | Screens, layouts, visual direction |
| [`docs/STACK.md`](docs/STACK.md) | Engineering stack choices and rationale |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Hackathon rules, Qloo API mapping, judging, prior winners |

## License

MIT, see [`LICENSE`](LICENSE).

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/).
