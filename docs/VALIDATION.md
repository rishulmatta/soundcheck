# Validation record and protocol

October 14, 2026: the Qloo key arrived and the live-data gate below was run against https://hackathon.api.qloo.com with direct calls (no model spend). Findings and the resulting code changes are recorded in `docs/STATUS.md` under "Key-day findings". Customer usefulness remains unvalidated. Raw responses stay outside Git.

## Live-data gate

Status per step (2026-10-14): 1 done locally, Railway pending the user's variable change; 2 Khruangbin resolved (entity `BAF6317A…`); 3 settled: separate heatmap queries do NOT share a scale, one region polygon query does, `take` has no effect on cells, `output.heatmap.boundary` fails with 500; 4 done: 40 km radius, top-10 mean, rankings stable across the sparse acts probed; 5 done: compare carries shared tags and per-side tag lists only, similarity is derived; 6 done: demographics ignore location, trending is 0..1 and flat, explainability is per-signal scores, localization changes related acts; 7 done: Khruangbin plus three sparse acts, tag fallback inspected; 8 changed by the user: saved examples stay synthetic, only new plans are live.

1. Configure the key and disable mock mode. Verify health and the new plan's persisted source independently; old examples stay synthetic.
2. Resolve the musician and confirm identity against an official external link.
3. Confirm with Qloo whether separate heatmap queries share a comparable scale, what popularity measures, and how boundaries and `take` affect results. Compare city queries with a regional/locality query. A maximum of 1 alone does not establish normalization semantics.
4. Vary cell limits and aggregation; record ranking changes. Keep rankings provisional until justified. Use a common reference query if independent normalization invalidates cross-query ranking.
5. Inspect actual comparison responses. Separate API quantities from derived similarity; do not claim shared-fan percentage.
6. Verify demographic scope, trending units, explanation fields, and whether localization parameters affect related-act results. HTTP 200 alone does not establish semantics.
7. Test a well-covered and sparse act. Inspect fallback tags, notes and status; empty data must not become confident advice.
8. Regenerate saved examples. Inspect page, tour, exports and revisions. Record dated, redacted request-to-decision evidence; keep raw Qloo responses outside Git.

## User evaluation: 3–5 people

Recruit artist managers, booking agents or independent promoters. Outreach has not been performed. Obtain permission for attributed quotes.

Task: choose a six-stop research shortlist for a fixed artist/region, retain a locked city, exclude another city, and identify one partner worth investigating. Observe without coaching. Record time, corrections, useful and unusable suggestions, and missing evidence before venue outreach.

| Participant ID / role | Completed? | Minutes | Useful decision | Incorrect suggestion | Product change |
| --- | --- | --- | --- | --- | --- |
| To be collected | | | | | |

Report actual counts, disagreements and failed tasks. Do not extrapolate sales or financial gains from subjective feedback.

## Comparison protocol

The optional in-app comparison matches the brief and constraints, but not tools, call count or token budget. It is illustrative, not a controlled benchmark.

For stronger evaluation, fix artist, candidate pool, locks, exclusions, count, window, assumptions, model, and output format. Compare with versus without Qloo evidence, disclose differing budgets, randomize A/B order, and ask domain users to judge feasibility, actionable detail, errors and constraint compliance. Reveal sources afterward to assess traceability. If a controlled agent ablation is not implemented, state the weaker comparison used.

Different city names or higher Qloo scores do not prove better outcomes. Report every evaluated case and failures.

| Brief | Configuration A/B | Constraints satisfied | Reviewer preference / reason | Errors | Limitations |
| --- | --- | --- | --- | --- | --- |
| To be collected | | | | | |

## Browser and release checklist

- [ ] Homepage, plan, tour, replay, CSV and print label synthetic/unknown sources.
- [ ] Notes survive persistence; legacy prose does not retain unsupported claims.
- [ ] Lock/drop/reorder and proposals work; original plans remain accessible.
- [ ] Changed briefs do not display stale comparisons.
- [ ] Mobile, keyboard, loading/error states and map fallback work.
- [ ] Budget limits return 429 with Retry-After; saved plans stay readable.
- [ ] Tests, types, lint and production build pass.
- [ ] Submission matches observed behavior and measured evidence.
- [ ] Repository and instructions are public; MIT license is detected.
- [ ] Hosting stays available through judging.
