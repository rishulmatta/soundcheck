import { describe, expect, it, vi } from "vitest";
import type { QlooClient, RelatedEntity } from "@/lib/qloo/contract";
import { Plan, PlanInput, type CityPoolEntry, type PlanEvent, type ToolResult, type ToolStatus } from "@/lib/types";
import type { AgentModel } from "./model";
import type { AgentToolSpec } from "./tools";
import { copyUsesOnlyGivenNumbers, numbersIn, runPlan, type RunDeps } from "./run";
import { cityPoolFor } from "./pool";

/* ---------------------------------------------------------------- stubs */

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const unit = (s: string) => (hash(s) % 1000) / 1000;

const ok = <T>(data: T, request: string, status: ToolStatus = "ok"): ToolResult<T> => ({ status, data, meta: { request, ms: 5, cached: false } });

interface StubOptions {
  /** Cities whose act-seeded heatmap is empty (thin data). */
  thinCities?: string[];
  searchEmpty?: boolean;
}

function stubQloo(opts: StubOptions = {}): QlooClient & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const hit = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const related = (prefix: string, n: number): RelatedEntity[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix} ${i}`,
      affinity: 0.9 - i * 0.05,
      popularity: 0.6,
      tags: ["indie"],
      explanation: i === 0 ? "Fans also favour shoegaze." : undefined,
    }));
  return {
    calls,
    async searchEntity(query, type) {
      hit("searchEntity");
      if (opts.searchEmpty) return ok([], "GET /search?query=[act]", "empty");
      return ok(
        [
          { id: "ent-act", name: query, type, popularity: 0.7, hint: "Artist · indie · popularity 0.70" },
          { id: "ent-other", name: `${query} Tribute`, type, popularity: 0.1, hint: "Artist · covers" },
        ],
        `GET /search?query=[act]&types=urn:entity:${type}`,
      );
    },
    async findTags(query) {
      hit("findTags");
      return ok([{ id: `urn:tag:${query.replace(/\W+/g, "_")}`, name: query }], "GET /v2/tags?filter.query=[q]");
    },
    async heatmapForCity(seed, city) {
      hit("heatmapForCity");
      const req = `GET /v2/insights?filter.type=urn:heatmap&filter.location.query=${encodeURIComponent(city.name)}`;
      const thin = seed.entityIds && opts.thinCities?.includes(city.id);
      if (thin) return ok({ city, affinity: 0, affinityRank: 0, popularity: 0, cells: [] }, req, "empty");
      return ok({ city, affinity: 0.4 + 0.6 * unit(city.id), affinityRank: 1, popularity: unit(city.id + "p"), cells: [] }, req);
    },
    async demographics(_seed, o) {
      hit("demographics");
      return ok(
        {
          age: [
            { bucket: "24_and_younger", score: 0.2 },
            { bucket: "25_to_29", score: 0.6 },
            { bucket: "30_to_34", score: 0.8 },
            { bucket: "55_and_older", score: -0.4 },
          ],
          gender: { female: 0.55, male: 0.45 },
        },
        `GET /v2/insights?filter.type=urn:demographics${o?.locationQuery ? "&signal.location.query=[city]" : ""}`,
      );
    },
    async trending() {
      hit("trending");
      return ok({ trend: "rising" as const, velocity: 0.42, weeks: 8 }, "GET /v2/trending?signal.interests.entities=[act]");
    },
    async relatedActs(_id, _type, o) {
      hit("relatedActs");
      return ok(related(`op-${o.locationQuery}`, 5), "GET /v2/insights?filter.type=urn:entity:artist&signal.location.query=[city]");
    },
    async compareAudiences(_a, b) {
      hit("compareAudiences");
      return ok({ overlap: 0.5 + unit(b) / 2, sharedTags: ["indie"] }, "GET /v2/analysis/compare?a=[act]&b=[opener]");
    },
    async brands() {
      hit("brands");
      return ok(related("br", 6), "GET /v2/insights?filter.type=urn:entity:brand");
    },
    async places(_id, o) {
      hit("places");
      return ok(related(`pl-${o.locationQuery}`, 4), "GET /v2/insights?filter.type=urn:entity:place&filter.location.query=[city]");
    },
    async tasteTags() {
      hit("tasteTags");
      return ok(
        [
          { id: "urn:tag:genre:indie", name: "indie rock" },
          { id: "urn:tag:genre:shoegaze", name: "shoegaze" },
          { id: "urn:tag:genre:dream_pop", name: "dream pop" },
        ],
        "GET /v2/insights?filter.type=urn:tag",
      );
    },
  };
}

const call = (tools: AgentToolSpec[], name: string, input: unknown) => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t.run(input);
};

function stubModel(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    id: "stub-model",
    runAgent: async () => ({ steps: 0, toolCalls: 0, text: "" }),
    writeStopCopy: async (facts) => {
      const f = facts as { city: string; qloo: { affinityMultipleVsPoolMedian: number }; soundcheck: { suggestedCapacity: number; quadrantLabel: string } };
      return {
        suggestion: `${f.soundcheck.suggestedCapacity}-cap room`,
        whyHere: `${f.city} is a ${f.soundcheck.quadrantLabel} at ${f.qloo.affinityMultipleVsPoolMedian}x the median Qloo affinity.`,
      };
    },
    planWithoutQloo: async () => ({ cities: ["New York", "Chicago"], openers: ["Some Band"], note: "Big cities." }),
    ...overrides,
  };
}

const baseInput: PlanInput = PlanInput.parse({ actQuery: "The Example Band", actType: "artist", region: "north-america", stops: 6 });

async function run(input: PlanInput, deps: Partial<RunDeps>) {
  const events: PlanEvent[] = [];
  const save = vi.fn(async () => {});
  const plan = await runPlan(input, (e) => events.push(e), { id: "test-plan", deps: { save, now: () => 1_760_000_000_000, ...deps } });
  return { plan, events, save };
}

/* ---------------------------------------------------------------- tests */

describe("runPlan without a model (orchestrator only)", () => {
  it("covers every checklist item and produces a valid plan", async () => {
    const qloo = stubQloo();
    const { plan, events, save } = await run(baseInput, { qloo, model: null });

    expect(Plan.safeParse(plan).success).toBe(true);
    expect(plan.id).toBe("test-plan");
    expect(plan.stops).toHaveLength(6);
    expect(plan.act).toMatchObject({ id: "ent-act", name: "The Example Band" });
    expect(plan.act.tasteTags).toContain("shoegaze");
    expect(plan.candidates.length).toBeGreaterThanOrEqual(12);
    expect(plan.momentum.trend).toBe("rising");
    for (const stop of plan.stops) {
      expect(stop.openers.length).toBeGreaterThan(0);
      expect(stop.openers[0].overlap).toBeGreaterThan(0);
      expect(stop.openers[0].reason).toMatch(/Qloo compare/);
      expect(stop.sponsors.length).toBeGreaterThan(0);
      expect(stop.places.length).toBeGreaterThan(0);
      expect(stop.demographics.age.length).toBeGreaterThan(0);
      expect(stop.suggestion).toMatch(/cap room/);
      expect(stop.whyHere).toMatch(/median Qloo affinity/);
    }
    expect(plan.stops[0].legDays).toBe(0);

    // All ten Qloo call types, every call on the trace with its redacted request.
    expect(plan.summary.qlooCallTypes).toBe(10);
    const traced = plan.trace.flatMap((s) => s.calls);
    expect(traced).toHaveLength(plan.summary.qlooCalls);
    expect(Object.values(qloo.calls).reduce((a, b) => a + b, 0)).toBe(plan.summary.qlooCalls);
    expect(traced.every((c) => c.request.startsWith("GET /"))).toBe(true);

    const agent = plan.trace.find((s) => s.id === "agent");
    expect(agent?.status).toBe("degraded");
    const guard = plan.trace.find((s) => s.id === "guard");
    expect(guard?.summary).toMatch(/heatmap/);

    // Event stream shape.
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((e) => e.type === "act")).toHaveLength(1);
    expect(events.some((e) => e.type === "candidates")).toBe(true);
    expect(events.some((e) => e.type === "momentum")).toBe(true);
    const stopEvents = events.filter((e): e is Extract<PlanEvent, { type: "stop" }> => e.type === "stop");
    expect(stopEvents.map((e) => e.stop.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.some((e) => e.type === "step" && e.step.endedAt === undefined)).toBe(true);
    expect(save).toHaveBeenCalledWith(plan);
  });

  it("respects locked and excluded cities", async () => {
    const input = PlanInput.parse({ ...baseInput, lockedCities: ["Omaha", "detroit"], excludedCities: ["New York", "chicago"] });
    const { plan } = await run(input, { qloo: stubQloo(), model: null });
    const ids = plan.stops.map((s) => s.city.id);
    expect(ids).toContain("omaha");
    expect(ids).toContain("detroit");
    expect(ids[0]).toBe("omaha");
    expect(plan.candidates.map((c) => c.id)).not.toContain("new-york");
    expect(plan.candidates.map((c) => c.id)).not.toContain("chicago");
  });

  it("re-seeds thin cities by taste tags and marks them degraded", async () => {
    const pool = cityPoolFor("north-america").slice(0, 12);
    const thin = ["boise", "phoenix"];
    const { plan } = await run(baseInput, { qloo: stubQloo({ thinCities: thin }), model: null, pool });
    for (const id of thin) {
      const c = plan.candidates.find((x) => x.id === id);
      expect(c?.status).toBe("degraded");
      expect(c?.affinity).toBeGreaterThan(0);
    }
    expect(plan.trace.find((s) => s.id === "score")?.status).toBe("degraded");
    expect(plan.summary.overallStatus).toBe("degraded");
  });

  it("still plans when the act cannot be resolved", async () => {
    const { plan } = await run(baseInput, { qloo: stubQloo({ searchEmpty: true }), model: null });
    expect(Plan.safeParse(plan).success).toBe(true);
    expect(plan.act.name).toBe("The Example Band");
    expect(plan.summary.overallStatus).toBe("degraded");
    expect(plan.trace.find((s) => s.id === "resolve")?.status).not.toBe("ok");
  });
});

describe("runPlan with a model", () => {
  it("lets the model drive, then fills the gaps it left", async () => {
    const qloo = stubQloo();
    const model = stubModel({
      async runAgent({ tools }) {
        const found = (await call(tools, "searchAct", { query: "The Example Band" })) as { candidates: { id: string }[] };
        await call(tools, "confirmAct", { entityId: found.candidates[0].id });
        await call(tools, "getTasteTags", {});
        // Under-probes on purpose: only 5 cities, below the guard's minimum of 12.
        await call(tools, "probeCities", { cityIds: ["seattle", "boise", "denver", "omaha", "tulsa"] });
        await call(tools, "scoreCities", {});
        const routed = (await call(tools, "routeTour", { stops: 4 })) as { order: { cityId: string }[] };
        expect(routed.order).toHaveLength(4);
        await call(tools, "findTags", { queries: ["live music venue"], purpose: "venue" });
        const bad = (await call(tools, "probeCities", { cityIds: [] })) as { error?: string };
        expect(bad.error).toBe("invalid input");
        return { steps: 8, toolCalls: 8, text: "Lead with untapped mid-size markets." };
      },
    });
    const { plan } = await run(baseInput, { qloo, model });

    const agent = plan.trace.find((s) => s.id === "agent");
    expect(agent?.status).toBe("ok");
    expect(agent?.summary).toMatch(/8 tool calls over 8 steps/);
    const guard = plan.trace.find((s) => s.id === "guard");
    expect(guard?.summary).toMatch(/probed 7 more cities/);
    expect(guard?.summary).toMatch(/re-routed/);
    expect(plan.candidates).toHaveLength(12);
    expect(plan.stops).toHaveLength(6); // guard re-routed with the requested stop count
    // The model's venue tag choice was kept (the guard did not pick its own).
    expect(qloo.calls.findTags).toBe(1);
    expect(plan.stops[0].whyHere).toMatch(/median Qloo affinity/);
    expect(plan.trace.find((s) => s.id === "explain")?.summary).toMatch(/model for 6\/6 stops/);
  });

  it("keeps the model's picks for a stop it finalized", async () => {
    const model = stubModel({
      async runAgent({ tools }) {
        const found = (await call(tools, "searchAct", { query: "The Example Band" })) as { candidates: { id: string }[] };
        await call(tools, "confirmAct", { entityId: found.candidates[0].id });
        const pool = cityPoolFor("north-america").map((c) => c.id);
        await call(tools, "probeCities", { cityIds: pool });
        await call(tools, "scoreCities", {});
        const routed = (await call(tools, "routeTour", {})) as { order: { cityId: string }[] };
        const first = routed.order[0].cityId;
        const ops = (await call(tools, "findOpeners", { cityIds: [first] })) as Record<string, { candidates: { id: string }[] }>;
        const pick = ops[first].candidates[3].id;
        await call(tools, "compareAudiences", { candidateIds: [pick] });
        const r = (await call(tools, "finalizeStop", { cityId: first, openerIds: [pick, "made-up"], sponsorIds: [], placeIds: [] })) as { dropped: number };
        expect(r.dropped).toBe(1);
        return { steps: 6, toolCalls: 6, text: "" };
      },
    });
    const { plan } = await run(baseInput, { qloo: stubQloo(), model });
    expect(plan.trace.find((s) => s.id === "agent")?.status).toBe("ok");
    expect(plan.stops[0].openers.map((o) => o.id)).toEqual([expect.stringMatching(/-3$/)]);
    expect(plan.stops[1].openers.length).toBe(2);
  });

  it("falls back to the orchestrator when the model throws, and to templates when copy invents numbers", async () => {
    let n = 0;
    const model = stubModel({
      runAgent: async () => {
        throw new Error("429 rate limited");
      },
      writeStopCopy: async (facts) => {
        n++;
        const f = facts as { city: string };
        return n % 2 ? { suggestion: "2,500-cap room", whyHere: `${f.city} sells 97% of tickets.` } : { suggestion: "A room that fits", whyHere: `${f.city} is primed.` };
      },
    });
    const { plan } = await run(baseInput, { qloo: stubQloo(), model, withoutQloo: true });
    expect(plan.stops).toHaveLength(6);
    const agent = plan.trace.find((s) => s.id === "agent");
    expect(agent?.status).toBe("degraded");
    expect(agent?.summary).toMatch(/Model unavailable \(429 rate limited\)/);
    expect(plan.stops.some((s) => s.whyHere.includes("97%"))).toBe(false);
    expect(plan.stops.some((s) => s.whyHere.endsWith("is primed."))).toBe(true);
    expect(plan.withoutQloo?.cities).toEqual(["New York", "Chicago"]);
  });
});

describe("number guard", () => {
  it("parses numbers with thousands separators and decimals", () => {
    expect(numbersIn("1,200-cap room, 1.4x, 8–10 weeks")).toEqual([1200, 1.4, 8, 10]);
  });
  it("accepts given numbers and their percentage form, rejects new ones", () => {
    const facts = { qloo: { affinity: 0.91, multiple: 1.4 }, soundcheck: { suggestedCapacity: 1200 } } as unknown as Parameters<typeof copyUsesOnlyGivenNumbers>[1];
    expect(copyUsesOnlyGivenNumbers({ suggestion: "1,200-cap room", whyHere: "1.4x affinity, 91% match" }, facts)).toBe(true);
    expect(copyUsesOnlyGivenNumbers({ suggestion: "1,500-cap room", whyHere: "1.4x" }, facts)).toBe(false);
  });
});

describe("pool fixture", () => {
  it("has unique ids per region", () => {
    for (const region of ["north-america", "uk-ireland", "europe"] as const) {
      const pool: CityPoolEntry[] = cityPoolFor(region);
      expect(new Set(pool.map((c) => c.id)).size).toBe(pool.length);
    }
  });
});
