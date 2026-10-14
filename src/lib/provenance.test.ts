import { describe, expect, it } from "vitest";
import sample from "@/fixtures/plan.sample.json";
import { Plan } from "./types";
import { createProvenance, provenanceFor, safePickReason, safePlanForDisplay, safeStopCopy } from "./provenance";
import { suggestCapacity } from "./economics";
import { resolveRoomTier } from "./room";

const legacy = () => Plan.parse(structuredClone(sample));

describe("saved plan provenance", () => {
  it("never infers live data from unlabelled ids or historical Qloo text", () => {
    const plan = legacy();
    expect(provenanceFor(plan)).toMatchObject({ dataMode: "unknown", heatmapComparability: "unverified", proseVersion: undefined });
    expect(provenanceFor({ ...plan, provenance: createProvenance("live") }).dataMode).toBe("live");
  });

  it("marks only live provenance region-normalized, and preserves a saved value", () => {
    expect(createProvenance("live").heatmapComparability).toBe("region-normalized");
    expect(createProvenance("mock").heatmapComparability).toBe("unverified");
    expect(createProvenance("unknown").heatmapComparability).toBe("unverified");
    const plan = legacy();
    // A live plan saved before the region heatmap keeps "unverified"; it is never upgraded from the data mode.
    plan.provenance = { ...createProvenance("live"), heatmapComparability: "unverified" };
    expect(provenanceFor(plan)).toMatchObject({ dataMode: "live", heatmapComparability: "unverified" });
    plan.provenance = createProvenance("live");
    expect(provenanceFor(plan)).toMatchObject({ dataMode: "live", heatmapComparability: "region-normalized" });
    // Synthetic ids override a contradictory saved value.
    plan.act.id = "mock-artist-example";
    expect(provenanceFor(plan)).toMatchObject({ dataMode: "mock", heatmapComparability: "unverified" });
  });

  it("words legacy fallback copy by the plan's comparability", () => {
    const plan = legacy();
    plan.provenance = { ...createProvenance("live"), proseVersion: undefined };
    const copy = safeStopCopy(plan, plan.stops[0]).whyHere;
    expect(copy).toContain("one region-wide Qloo heatmap");
    expect(copy).not.toContain("unverified");
    expect(copy).toContain("does not establish ticket demand");
  });

  it("anchors legacy fallback room sizes on the brief's room tier, or labels the tier as guessed", () => {
    const plan = legacy();
    plan.input.roomTier = "800to2000";
    const stated = safeStopCopy(plan, plan.stops[0]).suggestion;
    const cap = suggestCapacity(plan.stops[0].city, { tier: "800to2000", guessed: false });
    expect(stated).toBe(`Room-size assumption: ${cap.toLocaleString("en-US")} capacity, anchored on the stated 800 to 2,000 tier; validate demand before booking.`);

    plan.input.roomTier = undefined;
    const room = resolveRoomTier({}, plan.act.popularity);
    const guessed = safeStopCopy(plan, plan.stops[0]).suggestion;
    expect(guessed).toContain(`${suggestCapacity(plan.stops[0].city, room).toLocaleString("en-US")} capacity`);
    expect(guessed).toContain("guessed from Qloo popularity");
    // Callers without the input (act and stops only) get the same guess.
    const { input: _input, ...noInput } = plan;
    void _input;
    expect(safeStopCopy(noInput, plan.stops[0]).suggestion).toBe(guessed);
  });

  it("recognizes synthetic act and recommendation ids, even if contradictory metadata claims live", () => {
    const plan = legacy();
    plan.provenance = createProvenance("live");
    plan.act.id = "mock-artist-example";
    expect(provenanceFor(plan).dataMode).toBe("mock");
    plan.act.id = "entity-example";
    plan.stops[0].openers[0].id = "mock-artist-opener";
    expect(provenanceFor(plan).dataMode).toBe("mock");
  });

  it("suppresses old unverified prose and overlap percentages without modifying the saved source", () => {
    const plan = legacy();
    plan.stops[0].whyHere = "Nobody has played here; 2x more fans.";
    plan.stops[0].openers[0].reason = "80% audience overlap.";
    plan.stops[0].openers[0].overlap = 0.8;
    const safe = safePlanForDisplay(plan);
    expect(safe.stops[0].whyHere).toContain("comparability is unverified");
    expect(safe.stops[0].suggestion).toContain("Room-size assumption");
    expect(safe.stops[0].openers[0].reason).not.toContain("80%");
    expect(safe.stops[0].openers[0].overlap).toBeUndefined();
    expect(safe.stops[0].openers[0].tasteSimilarity).toBeUndefined();
    expect(plan.stops[0].whyHere).toContain("Nobody");
    expect(safe.provenance?.dataMode).toBe("unknown");
  });

  it("preserves newly constrained explanations and keeps derived similarity distinct from old overlap", () => {
    const plan = legacy();
    plan.provenance = createProvenance("mock");
    plan.stops[0].whyHere = "Synthetic example; comparability unverified.";
    plan.stops[0].openers[0].tasteSimilarity = 0.75;
    expect(safeStopCopy(plan, plan.stops[0]).whyHere).toBe(plan.stops[0].whyHere);
    expect(safePickReason(plan, plan.stops[0].openers[0])).toBe(plan.stops[0].openers[0].reason);
    expect(safePlanForDisplay(plan).stops[0].openers[0].tasteSimilarity).toBe(0.75);
  });
});
