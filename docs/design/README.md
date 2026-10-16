# Design artefacts

Brand and submission images for Soundcheck. Colours and type come from the Soundcheck Design System (link in `docs/UX.md`).

## Icon (`icon/`)

The tour route drawn as a check: an amber (`spot`) route with three stops, the middle stop in `signal` blue with the Qloo signal pulsing out from it, the "untapped market" the agent finds. Dark Stage ground (`bg` #121110).

| File | Use |
| --- | --- |
| `icon.svg` | Source. Edit this, then re-render the PNGs with `rsvg-convert -w N -h N icon.svg -o icon-N.png`. |
| `icon-1024.png`, `icon-512.png` | Devpost project icon, social avatars. |
| `icon-180.png` | Apple touch icon. |
| `icon-32.png` | Favicon size check. |

The app uses them through the Next.js file conventions in `src/app/`: `favicon.ico` (16, 32, 48 px built from these PNGs), `icon.svg`, `apple-icon.png` (180 px) and `opengraph-image.png` (1200 × 630, rendered from `gallery/cover.html`). Regenerate those when the icon changes.

## Gallery (`gallery/`)

3000 × 2000 PNGs (3:2, the ratio Devpost recommends, all under 1 MB), captured on 2026-10-16 from the production site https://soundcheck-amber-two.vercel.app at a 1500 × 1000 viewport, 2× scale, in headless Chrome. Plan shots use the first production live plan, `5kpsJZ9UKG` (Hermanos Gutiérrez, live Qloo data); the landing page shows the synthetic Khruangbin example as the site does.

| File | Shows |
| --- | --- |
| `00-cover.png` | Cover/thumbnail: icon, wordmark, tagline over the tour. Built from `cover.html`. |
| `01-landing.png` | Landing hero with the live route map. |
| `02-plan.png` | Plan header: resolved act, Qloo match, momentum, provenance banner, map and quadrant. |
| `03-tour.png` | Map tour at stop 3, San Diego, with the city card and quadrant thumbnail. |
| `04-markets-and-route.png` | Route map, "Markets to investigate" quadrant, route strip, route economics. |
| `05-city-card.png` | San Diego city card: affinity, audience, openers, sponsors, activations, reasoning. |
| `06-print.png` | Print/PDF preview in the Print theme. |

Capture note: city-card numbers count up when a card scrolls into view, so a full-page screenshot shows 0.00. Scroll each card into view and wait before capturing.
