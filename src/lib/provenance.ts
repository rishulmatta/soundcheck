/** Pure source and legacy-copy helpers shared by server exports and browser views. */
import type { Pick as PlanPick, Plan, PlanInput, PlanProvenance, Stop } from "./types";
import { roomSuggestion, suggestCapacity } from "./economics";
import { ROOM_TIERS, resolveRoomTier } from "./room";

/** `input` is optional so callers holding only the act and stops still work; without it the room tier is guessed. */
type SourcePlan = Pick<Plan, "act" | "stops" | "provenance"> & { input?: Pick<PlanInput, "roomTier"> };

/**
 * Live plans score cities from one region-wide heatmap query, so their values share a scale ("region-normalized").
 * Mock cells are synthetic per city and unknown sources are unestablished, so both stay "unverified".
 */
export function createProvenance(dataMode: PlanProvenance["dataMode"]): PlanProvenance {
  return {
    dataMode,
    heatmapComparability: dataMode === "live" ? "region-normalized" : "unverified",
    demographicsScope: "act-wide",
    similarityMethod: "derived-taste-similarity",
    scoringMethod: "heuristic-v1",
    proseVersion: 2,
  };
}

/**
 * Synthetic ids are positive evidence of mock data. The absence of such ids never establishes a live source.
 * Comparability is the saved value when present (legacy plans without one, and anything synthetic, are "unverified");
 * it is never upgraded from the data mode alone, so a live plan saved before the region heatmap stays unverified.
 */
export function provenanceFor(plan: SourcePlan): PlanProvenance {
  const synthetic = plan.act.id.startsWith("mock-") || plan.stops.some((stop) =>
    [...stop.openers, ...stop.sponsors, ...stop.places].some((pick) => pick.id.startsWith("mock-")),
  );
  const dataMode = synthetic ? "mock" : plan.provenance?.dataMode ?? "unknown";
  const heatmapComparability = !synthetic && plan.provenance?.heatmapComparability === "region-normalized" ? "region-normalized" : "unverified";
  return { ...createProvenance(dataMode), heatmapComparability, proseVersion: plan.provenance?.proseVersion };
}

export function safeStopCopy(plan: SourcePlan, stop: Stop): Pick<Stop, "suggestion" | "whyHere"> {
  const source = provenanceFor(plan);
  if (source.proseVersion === 2) return { suggestion: stop.suggestion, whyHere: stop.whyHere };
  const room = resolveRoomTier(plan.input ?? {}, plan.act.popularity);
  const capacity = suggestCapacity(stop.city, room);
  const prefix = source.dataMode === "mock" ? "Synthetic example" : "Provisional heuristic candidate";
  const scale = source.heatmapComparability === "region-normalized"
    ? "Values come from one region-wide Qloo heatmap"
    : "Cross-city comparability is unverified";
  return {
    suggestion: roomSuggestion(capacity, ROOM_TIERS[room.tier].label, room.guessed),
    whyHere: `${prefix}: recorded affinity ${stop.city.affinity.toFixed(2)}, popularity ${stop.city.popularity.toFixed(2)}. ${scale}; this does not establish ticket demand or booking history.`,
  };
}

/** Old saved explanations may assert local demographics or measured audience overlap; never replay them as facts. */
export function safePickReason(plan: SourcePlan, pick: PlanPick): string {
  const source = provenanceFor(plan);
  if (source.proseVersion === 2) return pick.reason;
  return source.dataMode === "mock"
    ? "Synthetic recommendation for demonstration only."
    : "Saved recommendation. Its evidence, availability and suitability need verification.";
}

/** Sanitizes legacy snapshots without rewriting the stored source or relabelling them as live. */
export function safePlanForDisplay(plan: Plan): Plan {
  const provenance = provenanceFor(plan);
  const stops = plan.stops.map((stop) => ({
    ...stop,
    ...safeStopCopy(plan, stop),
    ...Object.fromEntries((["openers", "sponsors", "places"] as const).map((kind) => [kind, stop[kind].map((pick) => ({
      ...pick,
      overlap: undefined,
      // Legacy values were not verified or documented, so do not rename them into the new index.
      tasteSimilarity: provenance.proseVersion === 2 ? pick.tasteSimilarity : undefined,
      reason: safePickReason(plan, pick),
    }))])),
  }));
  return { ...plan, provenance, stops };
}
