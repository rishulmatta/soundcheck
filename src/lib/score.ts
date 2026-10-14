/**
 * City scoring. Pure: turns per-city aggregates of one region-wide Qloo heatmap into CityScore rows for the
 * quadrant chart and routing.
 *
 * Scale (settled on key day, 2026-10-14): Qloo rank-normalizes heatmap affinity and popularity within each query,
 * so per-city queries are not comparable (every city tops out at 1). The client therefore runs ONE heatmap query
 * per region polygon and assigns cells to cities, so every city's affinity and popularity sit on the same 0..1
 * scale over the region's cells. That is what makes the comparisons below meaningful.
 *
 * Formula (documented for the write-up):
 *   underserved = 0.6 * affinity + 0.4 * (1 - popularity)   when affinity >= 0.5
 *   underserved = 0.6 * affinity                             when affinity <  0.5
 * The affinity gate stops a city that simply does not care about the act from looking "underserved" just because
 * the act is unknown there: low popularity is only an opportunity when the taste graph says the audience is primed.
 *
 * Quadrant:
 *   reach       = affinity <  0.5                                  (the region's taste is not primed for the act)
 *   untapped    = affinity >= 0.5 and affinity - popularity >= 0.02 (primed, and less known there than its fit suggests)
 *   established = affinity >= 0.5 otherwise                        (primed, and already as known as its fit suggests)
 * In region-normalized data affinity and popularity track each other closely for well-known acts, so "untapped" is
 * defined by the gap between them, not by a fixed popularity ceiling. The 0.02 margin is two rounding units: enough
 * to exclude ties, small enough that a modest gap counts. Sparse acts show gaps of 0.1-0.3 in live data.
 *
 * affinityRank is 1-based over the scored set, affinity descending (ties broken by lower popularity, then name).
 */
import type { CityHeatmap } from "@/lib/qloo/contract";
import type { CityScore, Quadrant, ToolStatus } from "@/lib/types";

export const AFFINITY_GATE = 0.5;
/** Minimum affinity - popularity for "untapped". */
export const UNTAPPED_GAP = 0.02;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function underservedScore(affinity: number, popularity: number): number {
  const a = clamp01(affinity);
  const p = clamp01(popularity);
  const raw = a >= AFFINITY_GATE ? 0.6 * a + 0.4 * (1 - p) : 0.6 * a;
  return round2(clamp01(raw));
}

export function quadrantOf(affinity: number, popularity: number): Quadrant {
  if (affinity < AFFINITY_GATE) return "reach";
  // Compare in hundredths so 0.52 - 0.50 is not 0.0199999 at the boundary.
  return Math.round((affinity - popularity) * 100) >= Math.round(UNTAPPED_GAP * 100) ? "untapped" : "established";
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
