# Soundcheck UX and design

**Design system (source of truth for tokens, type, components):** https://claude.ai/artifact/DKvPVuT6JumRtuxCKLdEbs
Agents building UI read its `project/README.md` first, then `project/tokens.json`. The Scorefluent design system in the same account belongs to another app and is never used here.

Guiding rule: it must look like a promoter's deliverable, not a chatbot. The agent is visible in a side rail, but the center of the screen is always the plan. Four screens plus a print view.

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
│ ROUTE ECONOMICS  [Soundcheck estimate]  Bus and truck                 │
│ Road 4,415 mi · Travel days 14 · Crew days 192 · Travel+crew $87,400  │
│ ①→② 505 mi 2d $8.4k  ②→③ 371 mi 1d $4.1k  … ⑧→⑨ 642 mi 2d FLY        │
│ ▸ Assumptions: $2.40/mi · $3,200/day · 8 crew · $45 ticket (editable) │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─ ② BOISE ──────────────────────────────────────────── Untapped ─┐  │
│ │ Affinity 0.91 (rank 3/38) · Popularity 0.22 · Suggest 1.2k room │  │
│ │ Break-even 162 tickets, 25% of the room (leg in + one show day) │  │
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
- **Route economics strip (added 2026-10-12):** under the route. Four stats (road distance, travel days, crew days, travel-and-crew estimate), one chip per leg with its distance, days and cost, and a collapsed "Assumptions" row where the budget tier and five rates (per mile or km, per day on the road, crew size, average ticket, fly-over threshold) are editable; a reset link appears once edited. Every number carries the "Soundcheck estimate" tag, never the Qloo tag. Legs over the tier's threshold are flagged "fly" in the warn colour and left unpriced. The footnote states what is excluded (venue hire, production, the act's fee, hotels, flights). Rationale: promoters cost a tour by dead days and drive length, not by hotel prices per city; the strip turns the travel-day gaps into money without inventing prices Qloo cannot supply. `src/lib/economics.ts` holds the model, `src/components/plan/RouteEconomics.tsx` the strip and the shared state hook.
- **City cards:** one per stop, each with a quadrant label (Untapped / Established / Reach), affinity and popularity numbers, a break-even line under "Soundcheck suggests" (tickets and share of the suggested room that cover the leg in plus one show day at the assumed ticket; turns warn above 70%; reads "flight leg in, not priced" when the leg is flown), audience bars from demographics, openers with `/v2/analysis/compare` overlap, sponsors and activations each with a "why" popover from `feature.explainability`, and a one-line "Why here" sentence. Thin data shows a muted "Limited Qloo data" band instead of an empty section.
- **Agent trace** collapses to a footer bar on the finished plan and expands to the full rail from Screen 2.
- **Provenance footer** on every plan satisfies the kit's safe-use rules.

## Screen 4: Map tour (presentation mode)

The plan as a self-running show. One button on the plan header ("Play tour") and the `#tour` anchor on seeded demo links open it. Judges who click one link see the whole argument in about 80 seconds without reading anything. It is also the source of the Devpost hero video and GIF.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [ACT NAME]                                   ┌─ quadrant mini ─┐  ✕ │
│ Stop 2 of 12 · BOISE                         │  ●◦   ·  ·      │    │
│                                              │  ·  ·    ·  ·   │    │
│          · ·  ·                              └─────────────────┘    │
│       ·  ◉ ◉ ◉  ·        full-bleed map, light basemap               │
│     ·  ◉ ◉②◉ ◉  ·        heatmap glow blooming around the stop      │
│       ·  ◉ ◉ ◉  ·        route leg drawing in from stop ①           │
│          · ·                                                        │
│  ┌─ TOUR CARD ───────────────────────────────┐                      │
│  │ ② BOISE                        Untapped   │                      │
│  │ Affinity 0.91  rank 3/38  pop 0.22  Qloo  │                      │
│  │ 25–34 ▇▇▇▇▇▇  skews female                │                      │
│  │ Opener  Act A · overlap 71%               │                      │
│  │ Sponsor Brand X                           │                      │
│  │ Fans over-index 4.1× here. Nobody has     │                      │
│  │ played within 300 mi.                     │                      │
│  └───────────────────────────────────────────┘                      │
│                  ‹   ▶ ❚❚   ›    ①②③④⑤⑥⑦⑧⑨⑩⑪⑫                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Layout.** The map fills the viewport in `bg-sunken`. Top-left: act name in `display-md` and "Stop n of N · CITY" in `label` plus `display-lg`. Top-right: a 200px quadrant thumbnail with the current city's dot ringed, and a close control. Bottom-left: the `TourCard`, a compact `CityCard` for one glance. Bottom-centre: `TourControls`, previous, play/pause, next, and one progress dot per stop. On phones the card spans the width above the controls and the quadrant thumbnail is hidden.

**Sequence per stop.** Default 6 seconds per stop, so a 12-stop tour runs about 80 seconds with the finale.

| Time | Map | Card and chrome |
|---|---|---|
| 0 ms | `flyTo` the stop, 1400 ms, zoom about 8.5, pitch 30, ease-in-out | Previous card slides out left, 200 ms. Header city name cross-fades. |
| 0 to 1200 ms | Route leg from the previous stop draws in `route`, synced to the fly | Progress dot for this stop starts its ring. |
| 1400 ms | Stop marker lands and pulses once (scale 1 to 1.4 to 1, 400 ms). Heatmap points bloom outward from the marker, opacity 0 to 0.4, 400 ms, staggered 20 ms by distance. | |
| 1600 ms | | `TourCard` slides up from the bottom edge, 300 ms ease-out. Affinity counts up 0.00 to its value over 500 ms in tabular mono so digits never jitter. |
| 2200 ms | | Audience bar fills, 400 ms. Opener, sponsor and the why-here sentence fade in 60 ms apart. |
| 2600 to 6000 ms | Hold. A slow 2 percent zoom drift keeps the frame alive. | Progress ring completes at 6000 ms. |
| 6000 ms | Next stop. | |

**Finale.** After the last stop the map `fitBounds` to the whole route over 1600 ms. The full route sits in `route`, every Untapped stop keeps its glow, Established stops dim to `ink-muted`. A summary card replaces the tour card: "12 stops · 5 untapped markets · 61 Qloo calls" in `data`, then Replay, Open plan, and Share buttons.

**Controls.** Space pauses, left and right arrows step, Escape returns to the plan page. Clicking a progress dot jumps to that stop. Hovering the card pauses the clock and shows the "why" popovers. Map scroll-zoom is off during the tour so a stray wheel does not break the frame; drag is allowed and resumes the sequence on release.

**Reduced motion.** `prefers-reduced-motion: reduce` swaps `flyTo` for `jumpTo`, drops the count-up and the bloom stagger, and shows cards at rest. Timings stay the same so the tour still narrates.

**Why it wins points.** Design: it is the moment the product looks finished. Impact: a Live Nation judge sees a routed tour with openers and sponsors in the time it takes to read a paragraph. Qloo depth: every card carries the `QlooTag`, and the finale states the call count.

## Motion across the app

The full rules, easings and durations live in the design system's brand book (Motion section) with three animated reference components: TourCard, TourControls and MotionPrimitives. This is where each move is used.

- **Landing.** The wordmark sets in place, then the three demo cards enter 40 ms apart, 12 px up with `ease-out`. Hovering a card raises its border and lifts the map thumbnail 2 px. Nothing else moves until the user clicks.
- **Live run.** The agent rail's current step shows a `spot` ring that breathes once per second. Skeleton blocks cross-fade into content in 200 ms as each tool result lands. Map pins drop in as heatmaps return. Quadrant dots land one by one, 40 ms apart, the highlighted cell's ground fading in first. City cards enter in route order once routing completes, 60 ms apart.
- **Finished plan.** On first paint the route draws over 600 ms and the affinity numbers count up. Hover linking across quadrant dot, map pin and city card in 150 ms. Clicking a card flies the map to its stop in 600 ms. The "why" popover enters 8 px up in 300 ms.
- **Map tour.** The full six-second beat per stop in Screen 4: fly, draw the leg, pulse the marker, bloom the heatmap, slide the card, count the number, fill the bar, hold.
- **Exports and share.** The share button swaps its label to "Copied" for 1.5 s; no toast. The print view has no motion at all.
- **Reduced motion.** Every move above keeps its state and timing and loses its travel. Checked once per screen in the verification pass.

## Print view (`/plan/[id]/print`)

Light theme, one city per page after a cover page with map and quadrant, no interactive elements. The cover carries the route economics strip in its static form (assumptions as one line of text) and each city page carries the break-even line, both at the plan's budget tier and default rates. Browser "Save as PDF" produces the promoter deliverable. CSV is one row per stop with all scores, openers, sponsors, venues, plus leg distance and unit, flight flag, leg cost estimate, currency, suggested capacity and break-even tickets, all at default rates.

## Map ground: mid grey on dark (decided 2026-10-13)

The basemap is a mid-grey ground inside the dark Stage theme: land `--map-land` `#534d45` (warm grey), water `--map-water` `#1e2128` (near the page background), pale labels and borders. The user previewed five shades on the live tour with the `?ground=dark|dim|mid|light|paper` switch in `src/components/map/basemap.ts` and chose `mid`; the earlier "light" decision of 2026-10-12 was made while a stale stylesheet was being served and is void. Tune the six `--map-*` tokens in `src/app/globals.css` (fallbacks in `basemap.ts`) if anything needs adjusting; the `?ground=` switch stays as a dev aid. The route (spot) and signal markers sit on this grey ground, so any new marker colour must be checked against `--map-land`. The print theme keeps its own light ground.
