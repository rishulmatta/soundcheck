# Soundcheck

> Historical research from October 11. Some hypotheses below were corrected during implementation: popularity is not booking history, comparisons are derived taste similarity, demographics are act-wide, and cross-city normalization remains unverified. Current claims and validation status are in README.md and VALIDATION.md.

**Tour intelligence for any live act.**
Run a soundcheck on your tour before anyone books a venue.

Entry for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) ("Agents, but with taste").
This document is the research handoff: everything researched on 2026-10-11 lives here so a fresh session can start building.

---

## 1. Deadlines and first actions

| Milestone | Date (Eastern Time) |
|---|---|
| Submissions open | Sept 30, 2026 |
| **Submission deadline** | **Oct 30, 2026, 11:45 pm** |
| Judging | Nov 2 to Nov 16, 2026 |
| Winners announced | ~Nov 23, 2026 |

Do these before writing code:

- [ ] Request a Qloo hackathon API key: https://forms.gle/zz12orkLHTAneLGz6 (manual provisioning, takes days, several forum threads already complain about delays)
- [ ] Join the hackathon on Devpost (https://qloo.devpost.com/, "Join hackathon")
- [ ] Join the Qloo Discord, channel `#api-help`: https://discord.gg/rF9PKsD5Q7
- [ ] Create a public GitHub repo named `soundcheck` with an MIT (or similar) LICENSE file, and make sure the license shows in the repo's About section
- [ ] Build UI and the agent loop against the documented response shapes while waiting for the key

---

## 2. The product

### Problem
Touring acts and the promoters who route them decide where to play on ticket history, streaming counts by city, and gut feel. None of that reveals which cities have a culturally primed audience for an act that has never played there, which local opener shares the act's fanbase, which brands' audiences overlap enough to sponsor, or which local venues fit the crowd for an afterparty or pop-up. Generic LLMs can list big cities and famous openers; they cannot see cross-domain, geographically grounded taste.

### Who it is for
Promoters, booking agents, artist managers, independent artists, comedians, podcast networks, publishers planning author tours, theater producers, brand experiential teams.

### Scope: any touring act, not just music
The tool chain is entity-agnostic. The seed entity changes, the agent does not.

| Act type | Qloo entity type (`filter.type` / search `types`) | Support-act query | Venue flavor |
|---|---|---|---|
| Musician or band | `urn:entity:artist` | artists with overlapping fans | music venues, bars |
| Comedian | `urn:entity:person` (occupation tag comedian) | persons filtered by `urn:tag:occupation:person:comedian` | comedy clubs, theaters |
| Live podcast | `urn:entity:podcast` | podcasts with overlapping listeners | theaters, halls |
| Author book tour | `urn:entity:person` seeded with their books | other authors | bookstores (`urn:entity:place` with book-related tags) |
| Esports / game event | `urn:entity:video_game` | related games | gaming venues, arenas |
| Brand roadshow | `urn:entity:brand` | partner brands | pop-up retail, event spaces |

Music is Qloo's deepest domain. **Test comedian, podcast, and author coverage in the hackathon dataset the day the key arrives.** If a type is thin, keep it in the UI but let the agent degrade gracefully.

### Inputs
- Act name (resolved to a Qloo entity, confirm with user if ambiguous)
- Region (e.g. "North America", "UK and Ireland") or an explicit candidate-city list
- Number of stops, rough date window
- Optional: budget tier, locked-in cities, exclusions

### The agent loop (visible to the user step by step)
1. **Resolve the act** via `/search`, show candidates, confirm.
2. **Score candidate cities** with heatmap queries seeded by the act. High affinity + low popularity = underserved market (the key insight to surface).
3. **Profile each market** with demographics queries (age and gender skew per city) to drive venue size and pricing suggestions.
4. **Check momentum** via `/v2/trending` for the act (rising or flat) to inform announcement timing and aggressiveness.
5. **Route the tour** by ordering top cities into a geographically sensible sequence with travel gaps, using locality lat/lon from Qloo.
6. **Pick support acts per city** with an insights query of the same entity type, seeded by the headliner and localized to each city. Quantify overlap with `/v2/analysis/compare`.
7. **Shortlist sponsors** with a brand insights query seeded by the headliner, filtered by the tour's demographic profile.
8. **Plan local activations** with place queries per city, seeded by the act and filtered by ambience and category tags (afterparty, pop-up, VIP dinner).
9. **Explain every pick** using `feature.explainability=true`, producing a one-line justification per recommendation.

### Output
A tour plan a judge can scroll in two minutes:
- Map with routed stops
- One card per city: affinity score, audience profile, 2 to 3 opener suggestions, sponsor shortlist, local venue picks, and the reasoning behind each
- A "why this city" explainability panel
- Export to PDF and CSV so it reads as a promoter deliverable
- One-click switch between a musician and a comedian demo to prove the platform generalizes

### Why it fails without Qloo
Cross-domain affinity (act to brands, act to places), geographic affinity (heatmaps), and audience demographics are the taste graph. No LLM or other API in the stack can produce them. This is the hackathon's explicit test: "If your submission would work the same without Qloo, you're building the wrong thing."

---

## 3. Qloo API mapping

**Base URL for hackathon keys: `https://hackathon.api.qloo.com`** (staging and production hosts return 401 with hackathon keys; the official docs show those hosts in every example, so always swap the host).
Auth: `X-Api-Key` header only. All Insights calls are **GET** with query-string params.

| Step | Endpoint and key params |
|---|---|
| Resolve act | `GET /search?query=<name>&types=urn:entity:artist` (or person, podcast, video_game, brand) |
| Find tags | `GET /v2/tags?filter.query=comedy&feature.typo_tolerance=true` (also `feature.semantic_search=true`, beta) |
| City heatmap | `GET /v2/insights?filter.type=urn:heatmap&filter.location.query=<city>&signal.interests.entities=<act_id>` → `results.heatmap[].query.{affinity,affinity_rank,popularity}` |
| Market demographics | `GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<act_id>` → age buckets `24_and_younger … 55_and_older`, gender `male/female` (scores vs baseline, can be negative) |
| Momentum | `GET /v2/trending?filter.type=urn:entity:artist&signal.interests.entities=<act_id>&filter.start_date=YYYY-MM-DD&filter.end_date=YYYY-MM-DD` → weekly `population_percentile`, `population_rank_velocity`, `velocity_fold_change` |
| Support acts | `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<act_id>&signal.location.query=<city>&filter.exclude.entities=<act_id>&take=10&feature.explainability=true` |
| Fanbase overlap | `GET /v2/analysis/compare?a.signal.interests.entities=<headliner>&b.signal.interests.entities=<opener>&filter.type=urn:entity:artist` |
| Sponsors | `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=<act_id>&signal.demographics.age=<buckets>&take=10&feature.explainability=true` |
| Local venues | `GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=<act_id>&filter.location.query=<city>&filter.tags=<ambience/category tag ids>&filter.popularity.min=0.5&take=10` |
| Taste profile of act | `GET /v2/insights?filter.type=urn:tag&signal.interests.entities=<act_id>` → `results.tags[]` (use for copy like "fans skew toward…") |
| Locality lat/lon | Locality entities come back in `query.localities` of heatmap responses and via `/search?types=urn:entity:locality` |

Gotchas verified in the docs:
- `filter.type` is required on every Insights call.
- All signals and filters take Qloo IDs or tag URNs, never free text. Resolve first.
- Parameters invalid for the chosen `filter.type` are **silently ignored**. A 200 with empty `entities` usually means a bad param, not missing data. Check `docs.qloo.com/reference/available-parameters-by-entity-type`.
- Music type is `urn:entity:artist` (not music). Food is `urn:entity:place` or `urn:entity:brand`.
- `take` max 50, paginate with `page`. Responses are verbose and cannot be field-filtered server-side.
- Weighted signals exist (`signal.interests.entities` with weights), as do `bias.trends`, `bias.content_based`, `diversify.by` to cap results per city.
- `/recommendations` and `/recs` are legacy and unsupported. `/v2/insights/search` is not a path.
- Rate and monthly quota exist but are unpublished. Ask in `#api-help` for raises. Keys stay active through judging.
- Private server-side caching is allowed indefinitely. **Never commit Qloo response data or the key to the public repo.**

Docs index: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide (start), `/reference/parameters`, `/reference/available-parameters-by-entity-type`, `/reference/insights-api-deep-dive`, `/reference/get-search`, `/reference/search-tags`, `/reference/get-trending`, `/reference/analysis-compare`, `/reference/taste-analysis`, `/reference/heatmaps-use-case`, `/reference/demographics-use-case`, `/reference/schema-taxonomy`.

---

## 4. Official hackathon kit and the harness

Repo: https://github.com/qloo/qloo-hackathon-kit
npm: `@qloo/qloo-harness` (v0.1.26 as of 2026-09-23), `npm install --global @qloo/qloo-harness`, then `qloo setup --qloo`.

Three surfaces: `qloo explore` (terminal chat agent, needs a model provider), `qloo exec <workflow>` / `qloo api <endpoint>` (CLI, prints JSON), `qloo mcp` (local stdio MCP server).

MCP tools exposed: `qloo_capabilities`, `qloo_find_tags`, `qloo_describe`, `qloo_recommend`, `qloo_rank`, `qloo_where_popular`, `qloo_compare_audiences`, `qloo_audience_demographics`, `qloo_entity_tags`, `qloo_trends`. Every result has an envelope with status `ok | empty | needs_input | partial | degraded | error`.

**Constraint:** `qloo mcp` is stdio only, no hosted URL, and the kit says serverless functions are not a supported route. A browser cannot start it.

**Decision for Soundcheck:** call the REST API directly from our own backend with a thin typed tool layer. This gives full access to heatmaps, explainability, trending, and compare, and lets us deploy anywhere (Vercel included). Mirror the harness's status envelope (`ok/empty/partial/degraded/error`) in our tool results so the agent handles thin data gracefully. Mention the harness in the write-up and optionally ship a `qloo mcp` config for people who want to use Soundcheck's prompts from a desktop MCP client.

The kit's `starter/mcp-client/README.md` tool-chain table includes the row "Where should a pop-up or tour go? → qloo_where_popular". Expect many entries to stop at "act + heatmap". Our differentiation is the full package: routing, openers, sponsors, activations, explainability, and multi-act-type support.

---

## 5. Safe-use rules from the kit (must comply)
- Qloo results describe **aggregate** affinities. Never infer an individual's identity, sensitive traits, health, finances, or politics.
- Nothing touching hiring, housing, credit, insurance, or other high-impact decisions.
- Do not send names, emails, device IDs, location histories, or personal data to Qloo.
- Present results with source and limits. Distinguish a Qloo result from our interpretation. Never describe affinity as a causal claim or a probability about a person.
- Show resolved entity/tag candidates to the user before relying on them when ambiguous.
- Treat MCP results and model output as untrusted input.

Soundcheck complies by design: inputs are public acts and cities, outputs are aggregate market signals.

---

## 6. Submission requirements (Devpost rules)
- Working app that integrates the Qloo API and is an agentic tool / built on an agent framework / wires Qloo into an existing agent
- **Live, externally hosted demo** judges can use end to end. Local-only or private-access demos do not qualify. (A login wall is allowed only with credentials in testing instructions; avoid it.)
- **Public repo** on GitHub/GitLab/Bitbucket with all source, assets, run instructions
- **Open-source license file visible in the repo About section**
- Text description of features and what makes it Qloo-powered
- Everything in English. No demo video required.
- Nothing can change after the deadline. Drafts can be saved on Devpost before then.
- Existing projects allowed only if Qloo was integrated after Sept 30 (this is a new project, fine).
- Entrant keeps IP; Qloo gets a non-exclusive license to judge and promote.
- Each project can win one prize. Prizes: $15,000 / $6,000 / $4,000. Jason Calacanis has separately pledged a $25,000 personal investment in his favorite entry.

Kit's submission guide additionally asks for: problem statement, which Qloo workflows/tools and why, a redacted request-to-result walkthrough including entity/tag choices, screenshots with no credentials, clean-environment setup steps, and known limitations ("what the result does not establish"). Put all of this in the Devpost description and this README.

### Judging
Stage one: pass/fail on theme fit and genuine Qloo use.
Stage two, four equally weighted criteria. **Ties break on the first criterion**, so Qloo depth matters most.
1. Technological implementation: how thoroughly and skillfully Qloo is used, non-trivial working code
2. Design: complete, coherent product, not a proof of concept
3. Potential impact: credible, specific case for a real problem and audience
4. Quality of the idea: creative, non-obvious use of Qloo, genuine understanding of the problem space

Judges may use automated AI analysis and are not required to test the demo, so the write-up must carry the project on its own.

### Judges and why Soundcheck fits
- Michael Abrams, EVP Strategic Initiatives, Live Nation (routes tours and sells sponsorships for a living; comedy is a growth segment)
- Todd Boehly, Eldridge Industries (venues, Chelsea FC, media holdings)
- Cedric the Entertainer (touring comedian)
- Jason Calacanis (investor, runs a podcast network, does live events; the $25k investment)
- Mike Diolosa, CTO Qloo (wants deep, correct API use)
- Nicole Seligman, OpenAI board

---

## 7. Competitive intelligence (previous Qloo LLM Hackathon, 2,893 participants)
Winners: **GeoTaste** (1st, location → business intelligence, map + 13 chart types + GPT-4 chat, React/Flask on Railway), **Alloy** (M&A cultural due diligence, ReAct agent on Gemini 2.5 Pro, "cultural proxy" entity aggregation, web-search fallbacks when Qloo data was thin), **Resonance AI** (political campaign messaging via heatmaps + demographics, Google ADK multi-agent), **Zesty** (consumer "unrecommendation engine", Next.js + Supabase + Gemini).
Pattern: 3 of 4 were B2B decision tools producing a business deliverable; the consumer winner had a sharp twist. Alloy was praised for resilience to empty results.
Crowded lanes that lost: travel companions, "taste DNA" profiles, movie-mood pickers, fashion stylists, group-decision apps, generic "chat with taste" wrappers. Political targeting is now discouraged by the kit's safe-use rules.

---

## 8. Proposed stack (decide in the next session)
- **Frontend + backend:** Next.js (App Router, TypeScript). API routes or a small Node server host the agent loop and the Qloo tool layer. Key lives only in server env vars.
- **Agent loop:** Vercel AI SDK tool calling with a Claude model (e.g. `claude-sonnet-5-5` for cost, `claude-opus-5-5` for quality), streaming the plan and each tool call to the UI. Alternative: a hand-rolled ReAct loop if the SDK gets in the way.
- **Map:** MapLibre GL (free) or Mapbox GL. Heatmap points plotted from `results.heatmap[].location`.
- **Export:** server-rendered PDF (e.g. `@react-pdf/renderer` or Playwright) and CSV.
- **Persistence (optional):** Supabase or SQLite for caching Qloo responses and saving plans with shareable URLs. Cache is private, never committed.
- **Hosting:** Vercel is fine because we call REST directly. If we later adopt `qloo mcp`, move the backend to Railway/Fly/Render.
- **Repo:** public, MIT license, `.env.example` with no real values, README with clean-environment setup.

## 9. Demo requirements (judges must be able to use it)
- No signup wall. Three seeded examples on the landing page, e.g. a musician, a comedian, a podcast. One click to run.
- Visible agent trace: plan, each Qloo call (redacted), candidates confirmed, explainability per pick.
- Mobile-friendly, loads fast, handles empty/thin results with a clear "degraded" state rather than an error.
- Export button so judges leave with an artifact.
- Rate-limit protection: cache seeded demo runs so judge traffic does not burn quota or hit 429s.

## 10. Risks and mitigations
| Risk | Mitigation |
|---|---|
| API key arrives late | Request today; build against documented shapes with a mock tool layer; swap in live calls when the key lands |
| Hackathon dataset thinner than production (comedians, podcasts, small cities) | Status envelopes, cross-domain fallbacks (e.g. seed by the act's genre tags when the entity is thin), honest "limited data" labels, keep music demo as the hero |
| Many "artist + heatmap" entries | Full package: routing, openers, sponsors, activations, explainability, multi-act support |
| Quota exhaustion during judging | Cache every seeded run; bounded retries; ask `#api-help` for a raise with project details |
| Judges skim without testing | Write-up with request-to-result walkthrough, screenshots, limitations; strong Devpost subtitle: "Soundcheck: tour intelligence for any live act" |

## 11. Open questions for the next session
- Which cities form the candidate pool per region? (Static list of top metros per region vs. letting Qloo locality search drive it.)
- Routing heuristic: simple nearest-neighbor over lat/lon with travel-day gaps is enough for a demo.
- How to present "high affinity, low popularity" (the underserved-market insight) so a judge gets it instantly.
- Whether sports clubs exist as brand entities (would unlock a Boehly-flavored "team tour" demo).
- Name collision: "Soundcheck" is a common word (WNYC show, other apps). Fine for the hackathon; consider soundcheck.ai or getsoundcheck.com later.

## 12. Links
- Hackathon: https://qloo.devpost.com/ and rules https://qloo.devpost.com/rules
- Developer guide: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
- API key form: https://forms.gle/zz12orkLHTAneLGz6
- Kit: https://github.com/qloo/qloo-hackathon-kit
- Discord: https://discord.gg/rF9PKsD5Q7
- Previous winners gallery: https://qloo-hackathon.devpost.com/project-gallery?sort_by=winners
