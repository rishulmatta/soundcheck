/** Pure source and legacy-copy helpers shared by server exports and browser views. */
import type { Pick as PlanPick, Plan, PlanProvenance, Stop } from "./types";
import { suggestCapacity } from "./economics";

type SourcePlan = Pick<Plan, "act" | "stops" | "provenance">;

export function createProvenance(dataMode: PlanProvenance["dataMode"]): PlanProvenance {
  return {
    dataMode,
    heatmapComparability: "unverified",
    demographicsScope: "act-wide",
    similarityMethod: "derived-taste-similarity",
    scoringMethod: "heuristic-v1",
    proseVersion: 2,
  };
}

/** Synthetic ids are positive evidence of mock data. The absence of such ids never establishes a live source. */
export function provenanceFor(plan: SourcePlan): PlanProvenance {
  const synthetic = plan.act.id.startsWith("mock-") || plan.stops.some((stop) =>
    [...stop.openers, ...stop.sponsors, ...stop.places].some((pick) => pick.id.startsWith("mock-")),
  );
  const dataMode = synthetic ? "mock" : plan.provenance?.dataMode ?? "unknown";
  return { ...createProvenance(dataMode), proseVersion: plan.provenance?.proseVersion };
}

export function safeStopCopy(plan: SourcePlan, stop: Stop): Pick<Stop, "suggestion" | "whyHere"> {
  const source = provenanceFor(plan);
  if (source.proseVersion === 2) return { suggestion: stop.suggestion, whyHere: stop.whyHere };
  const capacity = suggestCapacity(stop.city, plan.act.popularity ?? 0.5);
  const prefix = source.dataMode === "mock" ? "Synthetic example" : "Provisional heuristic candidate";
  return {
    suggestion: `Room-size assumption: ${capacity.toLocaleString("en-US")} capacity; validate demand before booking.`,
    whyHere: `${prefix}: recorded affinity ${stop.city.affinity.toFixed(2)}, popularity ${stop.city.popularity.toFixed(2)}. Cross-city comparability is unverified; this does not establish ticket demand or booking history.`,
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
