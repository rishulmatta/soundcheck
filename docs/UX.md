# Soundcheck UX and design

**Design system (source of truth for tokens, type, components):** https://claude.ai/artifact/DKvPVuT6JumRtuxCKLdEbs
Agents building UI read its `project/README.md` first, then `project/tokens.json`. The Scorefluent design system in the same account belongs to another app and is never used here.

Guiding rule: it must look like a promoter's deliverable, not a chatbot. The agent is visible in a side rail, but the center of the screen is always the plan. Three screens plus a print view.

**Visual direction:** dark "stage" theme (near-black background, one warm accent for the act, a cool accent for Qloo signals), condensed tour-poster display type for headings, tabular numerals for scores. Every number from Qloo carries a small "Qloo" tag so judges see provenance at a glance. Mobile stacks everything in the same order.

## Screen 1: Landing (`/`)

```
┌──────────────────────────────────────────────────────────────┐
│  SOUNDCHECK          Tour intelligence for any live act.      │
│  Run a soundcheck on your tour before anyone books a venue.   │
│                                                               │
│  ┌─ MUSICIAN ─────┐ ┌─ COMEDIAN ─────┐ ┌─ LIVE PODCAST ───┐   │
│  │ [act name]     │ │ [act name]     │ │ [show name]      │   │
│  │ North America  │ │ North America  │ │ US + Canada      │   │
│  │ 12 stops · Q1  │ │ 10 stops · Q1  │ │ 8 stops · Q2     │   │
│  │  Open plan →   │ │  Open plan →   │ │  Open plan →     │   │
│  └────────────────┘ └────────────────┘ └──────────────────┘   │
│                                                               │
│  ── or plan your own ──────────────────────────────────────   │
│  Act  [ Search any artist, comedian, podcast… ▾ ]  (type ▾)   │
│  Region [North America ▾]  Stops [10]  Window [Jan–Mar 2027]  │
│  Advanced: locked cities, exclusions, budget tier             │
│                                  [ Run soundcheck ]           │
└──────────────────────────────────────────────────────────────┘
```

- The three seeded cards open pre-computed plans instantly (cached). No waiting, no quota.
- Act search box autocompletes via `/search` and shows entity candidates with type and a disambiguation line (e.g. "Artist · Pop · 4.2M fans"). Picking one resolves the Qloo ID before the run starts.

## Screen 2: Live run (`/plan/[id]` while streaming)

Same layout as the finished plan, but the content fills in as the agent works. Left rail is the agent trace; the center shows skeletons that resolve step by step: map pins drop in as heatmaps return, quadrant dots appear, city cards slide in once routed.

```
┌─ AGENT ───────────────┬──────────────────────────────────────┐
│ ● Resolve act      ok │  [ map filling with heatmap pins ]   │
│ ● Score 38 cities  ok │                                      │
│   heatmap ×38 · 2.1s  │  [ quadrant: dots appearing ]        │
│ ◐ Profile markets  …  │                                      │
│   demographics ×12    │  ░░░░ city cards (skeleton) ░░░░     │
│ ○ Check momentum      │                                      │
│ ○ Route tour          │                                      │
│ ○ Openers / Sponsors  │                                      │
│ ○ Activations         │                                      │
│ ○ Explain picks       │                                      │
│                       │                                      │
│ ▸ show calls (redacted)                                      │
└───────────────────────┴──────────────────────────────────────┘
```

- Each step shows a status chip (`ok / empty / partial / degraded`) and expands to the redacted Qloo request and a one-line result summary. This is the auditable-depth evidence judges can screenshot.
- If the act is ambiguous or data is thin, the rail pauses with an inline prompt ("Did you mean…?" or "Limited Qloo data for this act. Continue with genre-seeded fallback?").

## Screen 3: Finished plan (`/plan/[id]`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [ACT NAME]  Artist · Qloo ID ✓   North America · 12 stops · Jan–Mar  │
│ Momentum ▲ Rising (8-wk rank velocity +0.42)   [Share] [PDF] [CSV]   │
│                                             [ Without Qloo ⇄ ]       │
├───────────────────────────────┬──────────────────────────────────────┤
│  MAP                          │  PRIMED BUT UNTAPPED                 │
│  routed stops numbered 1→12   │  affinity ↑                          │
│  heatmap dots per city        │   ┃ ● Boise   ● Tulsa      · LA      │
│  travel-day labels on legs    │   ┃ ● Omaha      ·  · Chicago · NYC  │
│                               │   ┃ ·     ·         ·    ·           │
│                               │   ┗━━━━━━━━━━━━━━━━━━━━━→ popularity │
│                               │  top-left quadrant shaded + labelled │
├───────────────────────────────┴──────────────────────────────────────┤
│ ROUTE  ①Seattle →2d→ ②Boise →1d→ ③SLC →2d→ ④Denver → … → ⑫NYC         │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─ ② BOISE ──────────────────────────────────────────── Untapped ─┐  │
│ │ Affinity 0.91 (rank 3/38) · Popularity 0.22 · Suggest 1.2k room │  │
│ │ Audience  18-24 ▇▇▇▇ 25-34 ▇▇▇▇▇▇ 35-44 ▇▇ · F 58% M 42%         │  │
│ │ Openers   Act A (fan overlap 71%) · Act B (64%) · Act C (58%)   │  │
│ │ Sponsors  Brand X · Brand Y · Brand Z  (why ▸)                  │  │
│ │ Activate  Venue P (afterparty) · Venue Q (pop-up) · Venue R     │  │
│ │ Why here  "Fans of [act] over-index 4.1× in Boise vs baseline,  │  │
│ │            yet the act has never played within 300 mi."  Qloo   │  │
│ └─────────────────────────────────────────────────────────────────┘  │
│ ┌─ ③ SALT LAKE CITY ──────────────────────────────── Established ─┐  │
│ │ …                                                               │  │
├──────────────────────────────────────────────────────────────────────┤
│ ▸ Agent trace (10 Qloo call types, 61 calls, all ok)                 │
│ Data: Qloo aggregate affinities. Not predictions about individuals.  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Header:** act with a verified-entity chip, run parameters, momentum badge from `/v2/trending`, and the three actions. "Without Qloo" toggles a side-by-side column showing a plain-LLM plan for the same inputs.
- **Map + quadrant** sit side by side above the fold. Hovering a quadrant dot highlights the matching map pin and city card. This pair is the screenshot that goes first on Devpost.
- **Route strip:** horizontal, numbered stops with travel-day gaps. Clicking a stop scrolls to its card.
- **City cards:** one per stop, each with a quadrant label (Untapped / Established / Reach), affinity and popularity numbers, audience bars from demographics, openers with `/v2/analysis/compare` overlap, sponsors and activations each with a "why" popover from `feature.explainability`, and a one-line "Why here" sentence. Thin data shows a muted "Limited Qloo data" band instead of an empty section.
- **Agent trace** collapses to a footer bar on the finished plan and expands to the full rail from Screen 2.
- **Provenance footer** on every plan satisfies the kit's safe-use rules.

## Print view (`/plan/[id]/print`)

Light theme, one city per page after a cover page with map and quadrant, no interactive elements. Browser "Save as PDF" produces the promoter deliverable. CSV is one row per stop with all scores, openers, sponsors, venues.
