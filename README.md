# Soundcheck

**Tour intelligence for any live act.**
Run a soundcheck on your tour before anyone books a venue.

Entry for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Deadline Oct 30, 2026.

> This README is a placeholder. The judge-facing version (problem, Qloo workflows, request-to-result walkthrough, setup, limitations) is written in the final week. See `docs/STATUS.md`.

## Run locally

```
pnpm install
cp .env.example .env.local        # QLOO_MOCK=1 runs on synthetic data until a Qloo key is set
QLOO_MOCK=1 pnpm dlx tsx scripts/seed.ts   # writes the three demo plans to .cache/plans
QLOO_MOCK=1 pnpm dev
```

Open `/plan/demo-musician` for a finished plan, `/plan/demo-musician/tour` for the self-running map tour, `/run?demo=1` for a replayed live run. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Docs

| File | What it is |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | Session handoff tracker. Start here. |
| [`docs/PLAN.md`](docs/PLAN.md) | Strategy, architecture, schedule, verification |
| [`docs/UX.md`](docs/UX.md) | Screens, layouts, visual direction |
| [`docs/STACK.md`](docs/STACK.md) | Engineering stack choices and rationale |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Hackathon rules, Qloo API mapping, judging, prior winners |

## License

MIT, see [`LICENSE`](LICENSE).
