/**
 * City scoring. Pure: turns per-city Qloo heatmap aggregates into CityScore rows for the quadrant chart and routing.
 *
 * Formula (documented for the write-up):
 *   underserved = 0.6 * affinity + 0.4 * (1 - popularity)   when affinity >= 0.5
 *   underserved = 0.6 * affinity                             when affinity <  0.5
 * The affinity gate stops a city that simply does not care about the act from looking "underserved" just because
 * the act is unknown there: low popularity is only an opportunity when the taste graph says the audience is primed.
 *
 * Quadrant:
 *   untapped    = affinity >= 0.7 and popularity <  0.5   ("primed, untapped": the signature insight)
 *   established = affinity >= 0.7 and popularity >= 0.5
 *   reach       = everything else
 *
 * affinityRank is 1-based over the scored set, affinity descending (ties broken by lower popularity, then name).
 */
import type { CityHeatmap } from "@/lib/qloo/contract";
import type { CityScore, Quadrant, ToolStatus } from "@/lib/types";

export const AFFINITY_GATE = 0.5;
export const QUADRANT_AFFINITY = 0.7;
export const QUADRANT_POPULARITY = 0.5;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function underservedScore(affinity: number, popularity: number): number {
  const a = clamp01(affinity);
  const p = clamp01(popularity);
  const raw = a >= AFFINITY_GATE ? 0.6 * a + 0.4 * (1 - p) : 0.6 * a;
  return round2(clamp01(raw));
}

export function quadrantOf(affinity: number, popularity: number): Quadrant {
  if (affinity >= QUADRANT_AFFINITY) return popularity < QUADRANT_POPULARITY ? "untapped" : "established";
  return "reach";
}

/** Heatmaps may carry the envelope status of the call that produced them; it defaults to "ok". */
export type ScorableHeatmap = CityHeatmap & { status?: ToolStatus };

export function scoreCities(heatmaps: ScorableHeatmap[]): CityScore[] {
  const rows = heatmaps.map((h) => {
    const affinity = round2(clamp01(h.affinity));
    const popularity = round2(clamp01(h.popularity));
    return {
      ...h.city,
      affinity,
      popularity,
      underserved: underservedScore(affinity, popularity),
      quadrant: quadrantOf(affinity, popularity),
      status: h.status ?? ("ok" as ToolStatus),
      affinityRank: 0,
    };
  });
  rows.sort((a, b) => b.affinity - a.affinity || a.popularity - b.popularity || a.name.localeCompare(b.name));
  return rows.map((r, i) => ({ ...r, affinityRank: i + 1 }));
}
