import { describe, expect, it, vi } from "vitest";
import type { CityHeatmap, QlooClient, RelatedEntity } from "@/lib/qloo/contract";
import { Plan, PlanInput, type CityPoolEntry, type PlanEvent, type ToolResult, type ToolStatus } from "@/lib/types";
import type { AgentModel } from "./model";
import type { AgentToolSpec } from "./tools";
import { copyMeetsEvidenceLimits, copyUsesOnlyGivenNumbers, leadAngle, numbersIn, runPlan, type RunDeps } from "./run";
import { MockQlooClient } from "@/lib/qloo/mock";
import { cityPoolFor } from "./pool";
import { applyChanges, describeChanges, revisionNote } from "@/lib/revision";
import { legDaysAlong } from "@/lib/routing";
import type { ChangeSet } from "@/lib/types";

/* ---------------------------------------------------------------- stubs */

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const unit = (s: string) => (hash(s) % 1000) / 1000;

const ok = <T>(data: T, request: string, status: ToolStatus = "ok"): ToolResult<T> => ({ status, data, meta: { request, ms: 5, cached: false } });

interface StubOptions {
  /** Cities whose act-seeded heatmap row has no cells in reach (thin data). */
  thinCities?: string[];
  searchEmpty?: boolean;
  mode?: "mock" | "live";
  trend?: { trend: "rising" | "flat" | "falling" | "unknown"; velocity?: number };
}

function stubQloo(opts: StubOptions = {}): QlooClient & { calls: Record<string, number>; heatmapRequests: { seed: "act" | "tags"; cities: string[] }[] } {
  const calls: Record<string, number> = {};
  const heatmapRequests: { seed: "act" | "tags"; cities: string[] }[] = [];
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
    mode: opts.mode ?? "mock",
    calls,
    heatmapRequests,
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
    async heatmapForCities(seed, cities, region) {
      hit("heatmapForCities");
      heatmapRequests.push({ seed: seed.entityIds ? "act" : "tags", cities: cities.map((c) => c.id) });
      const req = "GET /v2/insights?filter.type=urn:heatmap&filter.location=[region polygon]";
      const rows: CityHeatmap[] = cities.map((city) => {
        const thin = seed.entityIds && opts.thinCities?.includes(city.id);
        if (thin) return { city, affinity: 0, affinityRank: 0, popularity: 0, cells: [] };
        const affinity = 0.4 + 0.6 * unit(city.id);
        const popularity = unit(city.id + "p");
        return { city, affinity, affinityRank: 1, popularity, cells: [{ lat: city.lat, lon: city.lon, affinity, affinityRank: 1, popularity }] };
      });
      const thinCount = rows.filter((r) => r.cells.length === 0).length;
      const status: ToolStatus = thinCount === 0 ? "ok" : thinCount === rows.length ? "empty" : "partial";
      return ok({ region, polygon: "POLYGON((0 0,1 0,1 1,0 1,0 0))", cellCount: rows.length - thinCount, cities: rows }, req, status);
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
    async trending(_id, _type, o) {
      hit("trending");
      const t = opts.trend ?? { trend: "rising" as const, velocity: 0.42 };
      return ok({ ...t, weeks: o?.weeks }, "GET /v2/trending?signal.interests.entities=[act]");
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
      const f = facts as { city: string; qloo: { affinity: number }; soundcheck: { suggestedCapacity: number } };
      return {
        suggestion: `Room-size assumption: ${f.soundcheck.suggestedCapacity} capacity.`,
        whyHere: `${f.city} has recorded affinity ${f.qloo.affinity}; cross-city comparability is unverified.`,
      };
    },
    planWithoutQloo: async () => ({ cities: ["New York", "Chicago"], openers: ["Some Band"], note: "Big cities." }),
    proposeRevision: async () => ({ lock: [], unlock: [], drop: [], restore: [], note: "" }),
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
      expect(stop.openers[0].tasteSimilarity).toBeGreaterThan(0);
      expect(stop.openers[0].overlap).toBeUndefined();
      expect(stop.openers[0].reason).toMatch(/Derived taste similarity/);
      expect(stop.sponsors.length).toBeGreaterThan(0);
      expect(stop.places.length).toBeGreaterThan(0);
      expect(stop.demographics.age.length).toBeGreaterThan(0);
      expect(stop.suggestion).toMatch(/Room-size assumption/);
      expect(stop.whyHere).toMatch(/cross-city comparability is unverified/);
    }
    expect(plan.stops[0].legDays).toBe(0);
    // One region-wide heatmap query scores the whole pool; trending asks for the 26-week minimum.
    expect(qloo.calls.heatmapForCities).toBe(1);
    expect(plan.candidates).toHaveLength(cityPoolFor("north-america").length);
    expect(plan.momentum.weeks).toBe(26);
    expect(plan.trace.find((s) => s.id === "score")?.summary).toMatch(/^one region heatmap, \d+ cells, \d+ cities; \d+ primed-and-less-known candidates?$/);

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
    expect(plan.trace.find((s) => s.id === "score")?.summary).toMatch(/thin cities re-seeded by taste tags/);
    expect(plan.summary.overallStatus).toBe("degraded");
  });

  it("makes one act-seeded region call over the whole pool and one tag call for just the thin cities", async () => {
    const pool = cityPoolFor("north-america").slice(0, 12);
    const qloo = stubQloo({ thinCities: ["boise", "phoenix"] });
    const input = PlanInput.parse({ ...baseInput, excludedCities: ["seattle"] });
    const { plan } = await run(input, { qloo, model: null, pool });
    expect(qloo.calls.heatmapForCities).toBe(2);
    // The act-seeded polygon covers the region's full pool (exclusions included) so normalization is stable...
    expect(qloo.heatmapRequests[0]).toEqual({ seed: "act", cities: pool.map((c) => c.id) });
    // ...but excluded cities are never scored.
    expect(plan.candidates.map((c) => c.id)).not.toContain("seattle");
    expect(plan.candidates).toHaveLength(11);
    expect(qloo.heatmapRequests[1].seed).toBe("tags");
    expect([...qloo.heatmapRequests[1].cities].sort()).toEqual(["boise", "phoenix"]);
    // One trace entry per region call.
    expect(plan.trace.find((s) => s.id === "score")?.calls).toHaveLength(2);
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
        // Passes only 5 cities: the region-wide query still scores the whole pool, so the guard has nothing to add.
        const probed = (await call(tools, "probeCities", { cityIds: ["seattle", "boise", "denver", "omaha", "tulsa"] })) as { results: unknown[]; probed: number };
        expect(probed.results).toHaveLength(5);
        expect(probed.probed).toBe(cityPoolFor("north-america").length);
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
    expect(guard?.summary).not.toMatch(/heatmap/);
    expect(guard?.summary).toMatch(/re-routed to the requested 6 stops/);
    expect(qloo.calls.heatmapForCities).toBe(1);
    expect(plan.candidates).toHaveLength(cityPoolFor("north-america").length);
    expect(plan.stops).toHaveLength(6); // guard re-routed with the requested stop count
    // The model's venue tag choice was kept (the guard did not pick its own).
    expect(qloo.calls.findTags).toBe(1);
    expect(plan.stops[0].whyHere).toMatch(/cross-city comparability is unverified/);
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
    expect(plan.stops.every((s) => s.whyHere.includes("unverified"))).toBe(true);
    // A two-city baseline does not satisfy this six-stop brief and must not be published as a matched comparison.
    expect(plan.withoutQloo).toBeUndefined();
    expect(plan.trace.find((s) => s.id === "comparison")?.summary).toContain("requested 6");
  });
});

describe("runPlan revisions", () => {
  const pool = cityPoolFor("north-america");
  const changes = (c: Partial<ChangeSet>): ChangeSet => ({ lock: [], unlock: [], drop: [], restore: [], ...c });

  async function firstRun() {
    const { plan } = await run(baseInput, { qloo: stubQloo(), model: stubModel() });
    return plan;
  }

  async function revise(parent: Plan, c: ChangeSet, deps: Partial<RunDeps>) {
    const events: PlanEvent[] = [];
    const save = vi.fn(async () => {});
    const input = applyChanges(parent.input, c, pool);
    const note = revisionNote(describeChanges(c, parent, pool));
    const plan = await runPlan(input, (e) => events.push(e), {
      baseline: parent,
      changes: c,
      revisionNote: note,
      deps: { save, now: () => 1_760_000_100_000, ...deps },
    });
    return { plan, events, save, note };
  }

  it("re-plans a full revision without the agent loop and reuses the parent's copy where the leg is unchanged", async () => {
    const parent = await firstRun();
    const ids = parent.stops.map((s) => s.city.id);
    // Lock the opening city (so the route keeps its start) and drop the last stop: the early legs stay the same.
    const dropped = ids[ids.length - 1];
    const locked = ids[0];
    const runAgent = vi.fn(async () => ({ steps: 0, toolCalls: 0, text: "" }));
    const writeStopCopy = vi.fn(async () => ({ suggestion: "Room-size assumption needs checking", whyHere: "REWRITTEN; cross-city comparability is unverified" }));
    const c = changes({ drop: [dropped], lock: [locked] });
    const { plan, save, note } = await revise(parent, c, { qloo: stubQloo(), model: stubModel({ runAgent, writeStopCopy }) });

    expect(Plan.safeParse(plan).success).toBe(true);
    expect(plan.id).not.toBe(parent.id);
    expect(plan.parentId).toBe(parent.id);
    expect(plan.revision).toBe(2);
    expect(plan.revisionNote).toBe(note);
    expect(note).toMatch(/^Drop .+ · Lock .+$/);
    expect(runAgent).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(plan);

    const newIds = plan.stops.map((s) => s.city.id);
    expect(newIds).not.toContain(dropped);
    expect(newIds).toContain(locked);
    expect(newIds[0]).toBe(locked); // the first locked city starts the route
    expect(newIds).toHaveLength(parent.stops.length); // the freed slot is filled by the next best city
    expect(plan.input.excludedCities).toContain(dropped);
    expect(plan.input.lockedCities).toContain(locked);

    const parentBy = new Map(parent.stops.map((s, i) => [s.city.id, { stop: s, prev: i ? parent.stops[i - 1].city.id : null }]));
    let reused = 0;
    plan.stops.forEach((s, i) => {
      const p = parentBy.get(s.city.id);
      const same = p && p.prev === (i ? plan.stops[i - 1].city.id : null) && p.stop.legDays === s.legDays;
      if (same) {
        reused++;
        expect(s.whyHere).toBe(p.stop.whyHere);
        expect(s.suggestion).toBe(p.stop.suggestion);
      } else {
        expect(s.whyHere).toBe("REWRITTEN; cross-city comparability is unverified");
      }
      // Picks carried over for cities that stayed on the route.
      if (p) expect(s.openers.map((o) => o.id)).toEqual(p.stop.openers.map((o) => o.id));
    });
    expect(reused).toBeGreaterThan(0);
    expect(reused).toBeLessThan(plan.stops.length);
    expect(writeStopCopy).toHaveBeenCalledTimes(plan.stops.length - reused);
    const explain = plan.trace.find((s) => s.id === "explain");
    expect(explain?.summary).toContain(`city copy: ${reused} reused from the previous revision, ${plan.stops.length - reused} by model, 0 by template`);

    const agent = plan.trace.find((s) => s.id === "agent");
    expect(agent?.status).toBe("ok");
    expect(agent?.summary).toMatch(new RegExp(`^Revision of ${parent.id}: `));
    expect(plan.act.id).toBe(parent.act.id);
    expect(plan.summary.model?.id).toBe("stub-model");
  });

  it("re-scores the parent's candidate field, not the whole pool, so only the requested change moves the route", async () => {
    const field = ["seattle", "portland", "boise", "salt-lake-city", "denver", "omaha", "kansas-city", "minneapolis", "chicago", "detroit", "nashville", "atlanta", "tulsa", "austin"];
    // A parent scored over a narrower field (e.g. saved before the region-wide heatmap) keeps that field on revision.
    const { plan: parent } = await run(baseInput, { qloo: stubQloo(), model: null, pool: pool.filter((c) => field.includes(c.id)) });
    expect(parent.candidates.map((c) => c.id).sort()).toEqual([...field].sort());

    const ids = parent.stops.map((s) => s.city.id);
    const restoredParent = { ...parent, input: { ...parent.input, excludedCities: ["Halifax"] } };
    const qloo = stubQloo();
    const c = changes({ drop: [ids[2]], restore: ["halifax"] });
    const { plan } = await revise(restoredParent, c, { qloo, model: stubModel() });
    const expected = [...field.filter((id) => id !== ids[2]), "halifax"].sort();
    expect(plan.candidates.map((x) => x.id).sort()).toEqual(expected);
    // One act-seeded region call over the full pool (the same polygon as the parent's, so a cache hit live).
    expect(qloo.calls.heatmapForCities).toBe(1);
    expect(qloo.heatmapRequests[0].cities).toEqual(pool.map((city) => city.id));
    // Every surviving stop of the parent is still routed; one new city fills the dropped slot.
    const kept = ids.filter((id) => id !== ids[2]);
    expect(plan.stops.map((s) => s.city.id)).toEqual(expect.arrayContaining(kept));
    expect(plan.stops).toHaveLength(ids.length);
  });

  it("honours the parent's manual order on a later revision that keeps the same cities", async () => {
    const parent = await firstRun();
    const reversed = parent.stops.map((s) => s.city.id).reverse();
    const { plan } = await revise(parent, changes({ order: reversed, window: "Mar–Apr 2027" }), { qloo: stubQloo(), model: null });
    expect(plan.stops.map((s) => s.city.id)).toEqual(reversed);
    expect(plan.input.window).toBe("Mar–Apr 2027");
    expect(plan.trace.find((s) => s.id === "explain")?.summary).toMatch(/0 by model, \d+ by template/);
  });

  it("clones a reorder-only revision without touching Qloo or the model", async () => {
    const parent = await firstRun();
    const qloo = stubQloo();
    const runAgent = vi.fn(async () => ({ steps: 0, toolCalls: 0, text: "" }));
    const writeStopCopy = vi.fn(async () => ({ suggestion: "x", whyHere: "y" }));
    const ids = parent.stops.map((s) => s.city.id);
    const order = [ids[1], ids[0], ...ids.slice(2)];
    const t0 = performance.now();
    const { plan, events } = await revise(parent, changes({ order }), { qloo, model: stubModel({ runAgent, writeStopCopy }) });
    expect(performance.now() - t0).toBeLessThan(500);

    expect(qloo.calls).toEqual({});
    expect(runAgent).not.toHaveBeenCalled();
    expect(writeStopCopy).not.toHaveBeenCalled();
    expect(plan.revision).toBe(2);
    expect(plan.parentId).toBe(parent.id);
    expect(plan.id).not.toBe(parent.id);
    expect(plan.input.order).toEqual(order);
    expect(plan.stops.map((s) => s.city.id)).toEqual(order);
    expect(plan.stops.map((s) => s.order)).toEqual(order.map((_, i) => i + 1));
    expect(plan.stops.map((s) => s.legDays)).toEqual(legDaysAlong(plan.stops.map((s) => s.city)));
    expect(plan.stops[0].whyHere).toBe(parent.stops[1].whyHere);

    const revise_ = plan.trace.at(-1);
    expect(revise_).toMatchObject({ id: "revise", name: "Revise", status: "ok", calls: [] });
    expect(revise_?.summary).toMatch(/Reordered by hand/);
    expect(plan.trace).toHaveLength(parent.trace.length + 1);
    expect(plan.summary.qlooCalls).toBe(parent.summary.qlooCalls);
    expect(plan.candidates).toEqual(parent.candidates);

    expect(events.map((e) => e.type)).toEqual(["provenance", "act", "candidates", "momentum", "step", ...order.map(() => "stop"), "done"]);
    // The parent is untouched.
    expect(parent.stops.map((s) => s.city.id)).toEqual(ids);
    expect(parent.trace.some((s) => s.id === "revise")).toBe(false);
  });

  it("numbers a revision of a revision from its parent", async () => {
    const parent = { ...(await firstRun()), id: "rev-2", revision: 2, parentId: "test-plan" };
    const ids = parent.stops.map((s) => s.city.id);
    const { plan } = await revise(parent, changes({ order: [...ids].reverse() }), {});
    expect(plan.revision).toBe(3);
    expect(plan.parentId).toBe("rev-2");
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

describe("evidence and source safeguards", () => {
  it("persists source mode and limitations, emits them before results and preserves mock notes", async () => {
    const { plan, events } = await run(baseInput, { qloo: new MockQlooClient(), model: null });
    expect(plan.provenance).toMatchObject({ dataMode: "mock", heatmapComparability: "unverified", demographicsScope: "act-wide", proseVersion: 2 });
    expect(events[0]).toEqual({ type: "provenance", provenance: plan.provenance });
    expect(plan.trace.flatMap((step) => step.calls).some((call) => call.note?.includes("mock"))).toBe(true);
    expect(plan.stops.every((stop) => stop.openers.every((pick) => pick.overlap === undefined))).toBe(true);
    expect(plan.stops.every((stop) => stop.whyHere.includes("Synthetic example"))).toBe(true);
  });

  it("does not claim live provenance for an injected client without explicit source identity", async () => {
    const qloo = { ...stubQloo(), mode: undefined };
    const { plan } = await run(baseInput, { qloo, model: null });
    expect(plan.provenance?.dataMode).toBe("unknown");
  });

  it("labels live plans region-normalized and switches the copy rule from 'unverified' to the region heatmap", async () => {
    const qloo = stubQloo({ mode: "live", trend: { trend: "flat", velocity: 0 } });
    const seen: { qloo: { heatmapComparability: string; momentum: string }; writing: { leadWith: string } }[] = [];
    let n = 0;
    const model = stubModel({
      writeStopCopy: async (facts) => {
        const f = facts as { city: string; qloo: { affinity: number; heatmapComparability: string; momentum: string }; soundcheck: { suggestedCapacity: number }; writing: { leadWith: string } };
        seen.push(f);
        n++;
        return n % 2
          ? { suggestion: `Room-size assumption: ${f.soundcheck.suggestedCapacity} capacity.`, whyHere: `Affinity ${f.qloo.affinity} in Qloo's region-wide heatmap makes ${f.city} a research lead.` }
          : { suggestion: `Room-size assumption: ${f.soundcheck.suggestedCapacity} capacity.`, whyHere: `${f.city} has affinity ${f.qloo.affinity}.` };
      },
    });
    const { plan } = await run(baseInput, { qloo, model });
    expect(plan.provenance).toMatchObject({ dataMode: "live", heatmapComparability: "region-normalized" });
    expect(seen.every((f) => f.qloo.heatmapComparability === "region-normalized")).toBe(true);
    expect(seen.every((f) => f.qloo.momentum === "no movement in Qloo's series")).toBe(true);
    expect(seen.some((f) => f.writing.leadWith.includes("one region-wide Qloo heatmap"))).toBe(true);
    expect(plan.trace.find((s) => s.id === "momentum")?.summary).toBe("trending 26 weeks: no movement in Qloo's series");
    // Accepted model copy names the region heatmap; copy without it falls back to the region template.
    for (const stop of plan.stops) {
      expect(stop.whyHere).toMatch(/region-wide (?:Qloo )?heatmap/);
      expect(stop.whyHere).not.toMatch(/unverified/);
    }
    expect(plan.stops.some((s) => s.whyHere.startsWith("Research lead:"))).toBe(true);
    expect(plan.trace.find((s) => s.id === "explain")?.summary).toMatch(/model for 3\/6 stops/);
  });

  it("checks region-normalized copy for the region heatmap source and a research-lead framing", () => {
    const suggestion = "Room-size assumption: 1200 capacity";
    expect(copyMeetsEvidenceLimits({ suggestion, whyHere: "Affinity 0.8 in Qloo's region-wide heatmap; a lead to investigate." }, "region-normalized")).toBe(true);
    expect(copyMeetsEvidenceLimits({ suggestion, whyHere: "Affinity 0.8; cross-city comparability unverified" }, "region-normalized")).toBe(false);
    expect(copyMeetsEvidenceLimits({ suggestion, whyHere: "Affinity 0.8 in Qloo's region-wide heatmap." }, "region-normalized")).toBe(false);
    expect(copyMeetsEvidenceLimits({ suggestion, whyHere: "Region-wide heatmap says it will sell; a research lead." }, "region-normalized")).toBe(false);
    // Unverified facts keep the old rule.
    expect(copyMeetsEvidenceLimits({ suggestion, whyHere: "Affinity 0.8 in Qloo's region-wide heatmap; a lead to investigate." }, "unverified")).toBe(false);
  });

  it("rejects unsupported copy even when it uses only allowed numbers", () => {
    expect(copyMeetsEvidenceLimits({ suggestion: "Room-size assumption: 1200 capacity", whyHere: "80% audience overlap; comparability unverified" })).toBe(false);
    expect(copyMeetsEvidenceLimits({ suggestion: "1200-cap room", whyHere: "This city is primed" })).toBe(false);
    expect(copyMeetsEvidenceLimits({ suggestion: "Room-size assumption: 1200 capacity", whyHere: "Affinity 0.8; cross-city comparability unverified" })).toBe(true);
  });

  it("does not reuse synthetic entity ids and picks after switching a full revision to a live client", async () => {
    const { plan: parent } = await run(baseInput, { qloo: new MockQlooClient(), model: null });
    const qloo = { ...stubQloo(), mode: "live" as const };
    const plan = await runPlan({ ...baseInput, budgetTier: "van" }, () => {}, {
      baseline: parent,
      changes: { lock: [], unlock: [], drop: [], restore: [], budgetTier: "van" },
      deps: { qloo, model: null, save: async () => {} },
    });
    expect(qloo.calls.searchEntity).toBe(1);
    expect(plan.provenance?.dataMode).toBe("live");
    expect(plan.act.id).toBe("ent-act");
    expect(plan.stops.flatMap((stop) => stop.openers).every((pick) => !pick.id.startsWith("mock-"))).toBe(true);
  });

  it("publishes a comparison only after validating its brief and omits it on changed revisions", async () => {
    const cities = cityPoolFor(baseInput.region).slice(0, baseInput.stops).map((city) => city.name);
    const compare = vi.fn(async () => ({ cities, openers: [], note: "Unverified leads from general knowledge." }));
    const { plan: parent } = await run(baseInput, { qloo: stubQloo(), model: stubModel({ planWithoutQloo: compare }), withoutQloo: true });
    expect(parent.withoutQloo?.protocolVersion).toBe(2);
    expect(parent.trace.find((step) => step.id === "comparison")?.status).toBe("ok");
    const changedModel = await runPlan(baseInput, () => {}, {
      baseline: parent,
      changes: { lock: [], unlock: [], drop: [], restore: [] },
      deps: { qloo: stubQloo(), model: stubModel({ id: "different-model", planWithoutQloo: compare }), withoutQloo: true, save: async () => {} },
    });
    expect(changedModel.withoutQloo).toBeUndefined();
    expect(changedModel.trace.find((step) => step.id === "comparison")?.summary).toContain("model identity differs");
    const revised = await runPlan({ ...baseInput, stops: 5 }, () => {}, {
      baseline: parent,
      changes: { lock: [], unlock: [], drop: [], restore: [], stops: 5 },
      deps: { qloo: stubQloo(), model: stubModel({ planWithoutQloo: compare }), withoutQloo: true, save: async () => {} },
    });
    expect(compare).toHaveBeenCalledTimes(1);
    expect(revised.withoutQloo).toBeUndefined();
    expect(revised.trace.find((step) => step.id === "comparison")?.summary).toContain("planning brief changed");
  });

  it("records a failed comparison without publishing an unchecked baseline", async () => {
    const { plan } = await run(baseInput, { qloo: stubQloo(), model: stubModel({ planWithoutQloo: async () => { throw new Error("invalid output"); } }), withoutQloo: true });
    expect(plan.withoutQloo).toBeUndefined();
    expect(plan.trace.find((step) => step.id === "comparison")).toMatchObject({ status: "degraded", summary: "Comparison omitted: baseline generation or output validation failed" });
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

describe("leadAngle", () => {
  const demo = { age: [], gender: { female: 0, male: 0 }, status: "empty" as const };
  it("rotates through the angles the facts support, by stop order", () => {
    const a1 = leadAngle(1, demo, "unknown", 0);
    const a2 = leadAngle(2, demo, "unknown", 0);
    const a3 = leadAngle(3, demo, "unknown", 0);
    expect(a1).not.toBe(a2);
    expect(a3).toBe(a1);
  });
  it("names the region heatmap instead of the unverified caveat for region-normalized facts", () => {
    expect(leadAngle(1, demo, "unknown", 0, "region-normalized")).toMatch(/one region-wide Qloo heatmap/);
    expect(leadAngle(1, demo, "unknown", 0, "region-normalized")).not.toMatch(/unverified/);
    expect(leadAngle(1, demo, "unknown", 0)).toMatch(/comparability is unverified/);
  });
  it("adds momentum and travel angles only when there is something to say", () => {
    const angles = new Set([1, 2, 3, 4].map((o) => leadAngle(o, demo, "rising", 2)));
    expect(angles.size).toBe(4);
    expect([...angles].some((a) => a.includes("momentum"))).toBe(true);
    expect([...angles].some((a) => a.includes("travel"))).toBe(true);
  });
});
