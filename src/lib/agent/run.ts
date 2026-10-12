/**
 * The Soundcheck run: a tool-calling agent wrapped in a deterministic guard.
 *
 * 1. Agent loop: the model drives the plan through the tools in tools.ts (resolve the act, choose which cities to probe,
 *    re-seed thin data by tags, pick venue tags, choose sponsor age buckets, lock strategic cities, pick openers,
 *    sponsors and places per stop). Bounded by max steps and a wall-clock budget.
 * 2. Coverage guard: whatever the model skipped (or everything, if the model is unavailable) is run by the
 *    orchestrator with the same actions, and each fill is recorded on the "guard" trace step.
 * 3. Copy: the model phrases each stop's suggestion and whyHere from numbers we compute; any number it did not get
 *    is rejected and a template is used instead.
 * 4. Assembly: the plan is validated against the Plan schema, persisted, and streamed as the last event.
 */
import { nanoid } from "nanoid";
import { getQloo, type QlooClient, type RelatedEntity } from "@/lib/qloo";
import { putPlan } from "@/lib/store";
import { fetchActProfile, type ActProfile } from "@/lib/actProfile";
import { Plan, PlanInput, type ActType, type CityPoolEntry, type CityScore, type Demographics, type Momentum, type Pick as PickT, type PlanEvent, type Stop, type ToolStatus } from "@/lib/types";
import { matchesCity } from "@/lib/routing";
import { cityPoolFor, spreadPick } from "./pool";
import { agentPrompt, AGENT_INSTRUCTIONS, withoutQlooPrompt } from "./prompts";
import { createAnthropicModel, type AgentModel, type StopCopy } from "./model";
import {
  compareOpeners,
  createAgentTools,
  defaultVenueQueries,
  ensureAct,
  fetchDemographics,
  fetchMomentum,
  fetchOpeners,
  fetchPlaces,
  fetchSponsors,
  fetchTasteTags,
  findVenueTags,
  finalizeStop,
  mapLimit,
  newRunState,
  pendingThinCities,
  probeCities,
  route,
  score,
  topAgeBuckets,
  Tracer,
  type BrandSet,
  type RunContext,
  type StepId,
} from "./tools";

export const COVERAGE = [
  "act",
  "tasteTags",
  "heatmap",
  "demographics",
  "trending",
  "route",
  "openers",
  "compare",
  "brands",
  "places",
  "explanations",
] as const;
export type CoverageItem = (typeof COVERAGE)[number];

export interface RunDeps {
  qloo: QlooClient;
  /** null runs the plan with the orchestrator alone (no model key, or tests). */
  model: AgentModel | null;
  pool: CityPoolEntry[];
  /** Persist the finished plan. Defaults to putPlan. */
  save: (plan: Plan) => Promise<void>;
  now: () => number;
  maxSteps: number;
  /** Wall-clock budget for the agent loop before the guard takes over. */
  agentBudgetMs: number;
  withoutQloo: boolean;
  /** Picture, description and links for the resolved act, fetched online. Defaults to fetchActProfile; tests stub it. */
  profile: (name: string, type: ActType) => Promise<ActProfile | null>;
}

export interface RunOptions {
  id?: string;
  deps?: Partial<RunDeps>;
  signal?: AbortSignal;
}

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Defaults resolved lazily: getQloo() and the Anthropic model are only built when the caller did not inject them. */
function resolveDeps(input: PlanInput, injected: Partial<RunDeps> = {}): RunDeps {
  const has = <K extends keyof RunDeps>(k: K) => Object.prototype.hasOwnProperty.call(injected, k) && injected[k] !== undefined;
  return {
    qloo: has("qloo") ? injected.qloo! : getQloo(),
    model: "model" in injected ? (injected.model ?? null) : process.env.ANTHROPIC_API_KEY ? createAnthropicModel() : null,
    pool: has("pool") ? injected.pool! : cityPoolFor(input.region),
    save: putPlan,
    now: Date.now,
    maxSteps: envInt("SOUNDCHECK_MAX_STEPS", 30),
    agentBudgetMs: envInt("SOUNDCHECK_AGENT_BUDGET_MS", 150_000),
    withoutQloo: process.env.SOUNDCHECK_WITHOUT_QLOO === "1",
    // No network lookups inside the test runner.
    profile: process.env.VITEST ? async () => null : fetchActProfile,
    ...Object.fromEntries(Object.entries(injected).filter(([k, v]) => v !== undefined && k !== "qloo" && k !== "model" && k !== "pool")),
  };
}

/** Minimum heatmap coverage: every locked city plus at least max(12, stops + 4) cities, capped by the pool. */
export function minProbe(input: PlanInput, poolSize: number): number {
  return Math.min(poolSize, Math.max(12, input.stops + 4));
}

/* ------------------------------------------------------------------ guard */

async function ensureCoverage(ctx: RunContext, mark: (item: CoverageItem, detail: string) => void) {
  const { state, input } = ctx;

  if (!state.act) {
    await ensureAct(ctx);
    mark("act", "resolved the act");
  }
  if (!state.tasteTagsFetched) {
    await fetchTasteTags(ctx);
    mark("tasteTags", "fetched the taste profile");
  }

  // Heatmaps: every locked city, plus enough of the pool spread across the region. With nothing probed at all
  // (no model, or the model never got there) the whole pool is probed so the quadrant chart is complete.
  const want = state.heatmaps.size === 0 ? ctx.pool.length : minProbe(input, ctx.pool.length);
  const lockedIds = ctx.pool.filter((c) => input.lockedCities.some((k) => matchesCity(c, k))).map((c) => c.id);
  const lockedMissing = lockedIds.filter((id) => !state.heatmaps.has(id));
  const unprobed = ctx.pool.map((c) => c.id).filter((id) => !state.heatmaps.has(id) && !lockedIds.includes(id));
  const deficit = Math.max(0, want - state.heatmaps.size - lockedMissing.length);
  const toProbe = [...lockedMissing, ...spreadPick(unprobed, deficit)];
  let heatmapsChanged = false;
  if (toProbe.length) {
    await probeCities(ctx, toProbe, "act");
    mark("heatmap", `probed ${toProbe.length} more cities`);
    heatmapsChanged = true;
  }
  const thin = pendingThinCities(ctx);
  if (thin.length) {
    await probeCities(ctx, thin, "tags");
    mark("heatmap", `re-seeded ${thin.length} thin cities by taste tags`);
    heatmapsChanged = true;
  }
  if (heatmapsChanged || !state.candidates || state.candidates.length !== state.heatmaps.size) score(ctx);

  if (!state.momentum) {
    await fetchMomentum(ctx);
    mark("trending", "checked momentum");
  }
  if (!state.route || heatmapsChanged) {
    const hadRoute = Boolean(state.route);
    route(ctx);
    mark("route", hadRoute ? "re-routed after adding heatmaps" : "routed the tour");
  }
  const stopIds = state.route!.order.map((c) => c.id);

  const needDemo = !state.globalDemographics || stopIds.some((id) => !state.cityDemographics.has(id));
  if (needDemo) {
    await fetchDemographics(ctx, stopIds);
    mark("demographics", "profiled the routed cities");
  }

  const needOpeners = stopIds.filter((id) => !state.openers.has(id));
  if (needOpeners.length) {
    await fetchOpeners(ctx, needOpeners);
    mark("openers", `found openers for ${needOpeners.length} cities`);
  }
  const toCompare: string[] = [];
  for (const id of stopIds) {
    const items = state.openers.get(id)?.items ?? [];
    const compared = items.filter((e) => state.overlaps.has(e.id)).length;
    if (compared < Math.min(2, items.length)) toCompare.push(...items.slice(0, 3).map((e) => e.id).filter((x) => !state.overlaps.has(x)));
  }
  if (toCompare.length) {
    await compareOpeners(ctx, toCompare);
    mark("compare", `compared ${new Set(toCompare).size} opener audiences`);
  }

  if (!state.brandSets.length) {
    await fetchSponsors(ctx, topAgeBuckets(state.globalDemographics?.data));
    mark("brands", "shortlisted sponsors");
  }

  if (!state.venueTagsTried) {
    await findVenueTags(ctx, defaultVenueQueries(state.act!.type));
    mark("places", "chose venue tags");
  }
  const needPlaces = stopIds.filter((id) => !state.places.has(id));
  if (needPlaces.length) {
    await fetchPlaces(ctx, needPlaces);
    mark("places", `found places for ${needPlaces.length} cities`);
  }

  const unpicked = stopIds.filter((id) => !state.picks.has(id));
  for (const id of unpicked) finalizeStop(ctx, id, defaultPicks(ctx, id), "guard");
  if (unpicked.length) mark("openers", `picked openers, sponsors and places for ${unpicked.length} stops`);
}

function bestBrandSet(sets: BrandSet[], buckets: string[]): BrandSet | undefined {
  const usable = sets.filter((s) => s.items.length);
  return (
    usable.find((s) => s.ageBuckets.length && s.ageBuckets.every((b) => buckets.includes(b))) ??
    usable.find((s) => s.ageBuckets.some((b) => buckets.includes(b))) ??
    usable[0]
  );
}

function defaultPicks(ctx: RunContext, cityId: string) {
  const { state } = ctx;
  const openers = [...(state.openers.get(cityId)?.items ?? [])].sort(
    (a, b) => (state.overlaps.get(b.id)?.overlap ?? -1) - (state.overlaps.get(a.id)?.overlap ?? -1) || (b.affinity ?? 0) - (a.affinity ?? 0),
  );
  const demo = state.cityDemographics.get(cityId);
  const brands = bestBrandSet(state.brandSets, topAgeBuckets(demo))?.items ?? [];
  const places = state.places.get(cityId)?.items ?? [];
  return {
    openerIds: openers.slice(0, 2).map((e) => e.id),
    sponsorIds: brands.slice(0, 3).map((e) => e.id),
    placeIds: places.slice(0, 3).map((e) => e.id),
  };
}

/* ---------------------------------------------------------- stop assembly */

const pct = (n: number) => `${Math.round(n * 100)}%`;
const QUADRANT_LABEL: Record<CityScore["quadrant"], string> = {
  untapped: "primed but untapped market",
  established: "established market",
  reach: "reach market",
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Soundcheck's own venue-size heuristic (not a Qloo output): metro size scaled by affinity, local popularity and act popularity. */
export function suggestCapacity(city: CityScore, actPopularity = 0.5): number {
  const metro = city.metroM ?? 1;
  const base = 250 + 540 * Math.sqrt(metro);
  const raw = base * (0.4 + 0.6 * city.affinity) * (0.5 + 0.5 * city.popularity) * (0.5 + actPopularity);
  const clamped = Math.min(6000, Math.max(150, raw));
  return clamped < 1000 ? Math.round(clamped / 50) * 50 : Math.round(clamped / 100) * 100;
}

/** Announce lead time in weeks: untapped markets need a longer runway; momentum shortens or lengthens it. */
export function announceWeeks(quadrant: CityScore["quadrant"], trend: Momentum["trend"]): [number, number] {
  const base: Record<CityScore["quadrant"], [number, number]> = { untapped: [10, 12], reach: [8, 10], established: [6, 8] };
  const shift = trend === "rising" ? -2 : trend === "falling" ? 2 : 0;
  const [a, b] = base[quadrant];
  return [Math.max(4, a + shift), Math.max(5, b + shift)];
}

function toPick(e: RelatedEntity, reason: string, overlap?: number): PickT {
  return { id: e.id, name: e.name, overlap, reason, tags: e.tags.slice(0, 4) };
}

function buildPicks(ctx: RunContext, city: CityScore): Pick<Stop, "openers" | "sponsors" | "places"> {
  const { state } = ctx;
  const act = state.act!;
  const picks = state.picks.get(city.id) ?? { ...defaultPicks(ctx, city.id), by: "guard" as const };
  const openerItems = state.openers.get(city.id)?.items ?? [];
  const openers = (picks.openerIds ?? [])
    .map((id) => openerItems.find((e) => e.id === id))
    .filter((e): e is RelatedEntity => Boolean(e))
    .map((e) => {
      const ov = state.overlaps.get(e.id);
      const has = ov && (ov.status === "ok" || ov.status === "partial");
      const base = has ? `Qloo compare: ${pct(ov.overlap)} audience overlap with ${act.name}.` : `Qloo ranks it among acts that ${city.name} audiences of ${act.name} also favour.`;
      return toPick(e, e.explanation ? `${base} ${e.explanation}` : base, has ? ov.overlap : undefined);
    });
  const demo = state.cityDemographics.get(city.id);
  const ages = topAgeBuckets(demo).map((b) => b.replace(/_/g, " "));
  const allBrands = state.brandSets.flatMap((s) => s.items);
  const sponsors = (picks.sponsorIds ?? [])
    .map((id) => allBrands.find((e) => e.id === id))
    .filter((e): e is RelatedEntity => Boolean(e))
    .map((e) =>
      toPick(
        e,
        e.explanation ??
          `Qloo brand affinity with ${act.name}'s audience${ages.length ? `, which over-indexes ${ages.join(" and ")} in ${city.name}` : ""}.`,
      ),
    );
  const placeItems = state.places.get(city.id)?.items ?? [];
  const venueTagNames = state.venueTags.map((t) => t.name);
  const places = (picks.placeIds ?? [])
    .map((id) => placeItems.find((e) => e.id === id))
    .filter((e): e is RelatedEntity => Boolean(e))
    .map((e) =>
      toPick(e, e.explanation ?? `Qloo place affinity with ${act.name} in ${city.name}${venueTagNames.length ? `, matching ${venueTagNames.slice(0, 2).join(" / ")}` : ""}.`),
    );
  return { openers, sponsors, places };
}

function stopDemographics(ctx: RunContext, cityId: string): Demographics {
  return ctx.state.cityDemographics.get(cityId) ?? { age: [], gender: { female: 0, male: 0 }, status: "empty" };
}

export function copyFacts(ctx: RunContext, city: CityScore, legDays: number, demo: Demographics, order = 1) {
  const { state, input } = ctx;
  const act = state.act!;
  const cands = state.candidates ?? [];
  const med = median(cands.map((c) => c.affinity));
  const multiple = med > 0 ? Math.round((city.affinity / med) * 10) / 10 : 1;
  const trend = state.momentum?.trend ?? "unknown";
  const [w1, w2] = announceWeeks(city.quadrant, trend);
  return {
    act: act.name,
    actType: act.type,
    city: city.name,
    country: city.country,
    qloo: {
      affinity: city.affinity,
      popularity: city.popularity,
      affinityRank: city.affinityRank,
      citiesScored: cands.length,
      affinityMultipleVsPoolMedian: multiple,
      topAgeBuckets: topAgeBuckets(demo),
      femaleScoreVsBaseline: demo.gender.female,
      momentum: trend,
    },
    soundcheck: {
      quadrant: city.quadrant,
      quadrantLabel: QUADRANT_LABEL[city.quadrant],
      underserved: city.underserved,
      suggestedCapacity: suggestCapacity(city, act.popularity ?? 0.5),
      announceWeeksMin: w1,
      announceWeeksMax: w2,
      travelDaysFromPreviousStop: legDays,
    },
    window: input.window,
    writing: { stopOrder: order, leadWith: leadAngle(order, demo, trend, legDays) },
  };
}

/**
 * The evidence each stop's whyHere sentence opens with. Copy is written one stop at a time, so without this every
 * sentence lands on the same template. Picks only angles the facts can support, rotating by tour order.
 */
export function leadAngle(order: number, demo: Demographics, trend: string, legDays: number): string {
  const angles: string[] = ["affinity rank among the cities scored"];
  if (topAgeBuckets(demo).length) angles.push("the age buckets that over-index");
  if (trend === "rising" || trend === "falling") angles.push("momentum");
  if (legDays > 0) angles.push("the travel days from the previous stop and why the routing works");
  angles.push("the gap between affinity and popularity");
  return angles[(order - 1) % angles.length];
}

type Facts = ReturnType<typeof copyFacts>;

export function templateCopy(f: Facts): StopCopy {
  const cap = f.soundcheck.suggestedCapacity.toLocaleString("en-US");
  return {
    suggestion: `${cap}-cap room; announce ${f.soundcheck.announceWeeksMin}–${f.soundcheck.announceWeeksMax} weeks out`,
    whyHere: `${f.city} shows ${f.qloo.affinityMultipleVsPoolMedian}x the pool's median Qloo affinity for ${f.act} at ${f.qloo.popularity} popularity: a ${f.soundcheck.quadrantLabel}.`,
  };
}

/** Every number in the text, thousands separators removed. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((m) => Number(/^\d{1,3}(,\d{3})+$/.test(m) ? m.replace(/,/g, "") : m.replace(/,/g, "."))).filter(Number.isFinite);
}

/** True when the model only used numbers we handed it (including 0..1 values written as percentages). */
export function copyUsesOnlyGivenNumbers(copy: StopCopy, facts: Facts): boolean {
  const allowed = new Set<number>();
  for (const n of numbersIn(JSON.stringify(facts))) {
    allowed.add(n);
    if (n > 0 && n <= 1) allowed.add(Math.round(n * 100));
  }
  return numbersIn(`${copy.suggestion} ${copy.whyHere}`).every((n) => allowed.has(n));
}

/* -------------------------------------------------------------------- run */

function overallStatus(steps: { id: string; status: ToolStatus }[], actResolved: boolean): ToolStatus {
  const data = steps.filter((s) => s.id !== "agent" && s.id !== "guard");
  if (!actResolved || data.some((s) => s.status === "degraded")) return "degraded";
  return data.every((s) => s.status === "ok") ? "ok" : "partial";
}

export async function runPlan(rawInput: PlanInput, emit: (e: PlanEvent) => void, opts: RunOptions = {}): Promise<Plan> {
  const input = PlanInput.parse(rawInput);
  const deps = resolveDeps(input, opts.deps);
  const qloo = deps.qloo;
  const excluded = (c: CityPoolEntry) => input.excludedCities.some((k) => matchesCity(c, k));
  const tracer = new Tracer(emit, deps.now);
  const ctx: RunContext = { input, qloo, pool: deps.pool.filter((c) => !excluded(c)), tracer, state: newRunState(), emit, profile: deps.profile };

  // 1. Agent loop.
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>) => {
    inflight.add(p);
    p.finally(() => inflight.delete(p)).catch(() => {});
    return p;
  };
  tracer.begin("agent", deps.model ? `Agent loop (${deps.model.id})` : "Agent loop");
  let agentSummary: string;
  if (deps.model) {
    const budget = AbortSignal.timeout(deps.agentBudgetMs);
    const signal = opts.signal ? AbortSignal.any([budget, opts.signal]) : budget;
    try {
      const r = await deps.model.runAgent({
        instructions: AGENT_INSTRUCTIONS,
        prompt: agentPrompt(input, ctx.pool),
        tools: createAgentTools(ctx, track),
        maxSteps: deps.maxSteps,
        signal,
      });
      agentSummary = `${r.toolCalls} tool calls over ${r.steps} steps${r.text ? `. ${r.text.trim().slice(0, 400)}` : ""}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      agentSummary = budget.aborted ? "Model hit the time budget; the orchestrator finished the plan" : `Model unavailable (${msg.slice(0, 160)}); the orchestrator finished the plan`;
      tracer.mark("agent", "degraded");
    }
  } else {
    agentSummary = "No model configured; the orchestrator ran the plan deterministically";
    tracer.mark("agent", "degraded");
  }
  await Promise.allSettled([...inflight]);
  tracer.end("agent", agentSummary);
  opts.signal?.throwIfAborted();

  // 2. Coverage guard.
  const filled: string[] = [];
  const filledItems = new Set<CoverageItem>();
  await ensureCoverage(ctx, (item, detail) => {
    if (filled.length === 0) tracer.begin("guard", "Coverage guard");
    filled.push(detail);
    filledItems.add(item);
  });
  if (filled.length) tracer.end("guard", `Model skipped ${[...filledItems].join(", ")}; orchestrator ${filled.join("; ")}`);

  // Picture, description and links for the act (started when the act resolved; bounded by its own timeouts).
  await ctx.state.profilePromise;

  // 3. Stops and copy.
  const { state } = ctx;
  const order = state.route?.order ?? [];
  const legDays = state.route?.legDays ?? [];
  tracer.begin("explain", "Explain picks");
  let modelCopies = 0;
  const stops: Stop[] = new Array(order.length);
  // Stops stream in tour order: each is emitted as soon as it and every earlier stop is ready.
  let flushed = 0;
  const flush = () => {
    while (flushed < stops.length && stops[flushed]) emit({ type: "stop", stop: stops[flushed++] });
  };
  await mapLimit(order, 4, async (city, i) => {
    const demo = stopDemographics(ctx, city.id);
    const facts = copyFacts(ctx, city, legDays[i] ?? 0, demo, i + 1);
    let copy = templateCopy(facts);
    if (deps.model) {
      try {
        const signal = opts.signal ? AbortSignal.any([AbortSignal.timeout(30_000), opts.signal]) : AbortSignal.timeout(30_000);
        const c = await deps.model.writeStopCopy(facts, signal);
        if (copyUsesOnlyGivenNumbers(c, facts)) {
          copy = c;
          modelCopies++;
        }
      } catch {
        // keep the template
      }
    }
    const stop: Stop = { order: i + 1, city, legDays: legDays[i] ?? 0, demographics: demo, ...buildPicks(ctx, city), ...copy };
    stops[i] = stop;
    flush();
  });
  const picksCount = stops.reduce((n, s) => n + s.openers.length + s.sponsors.length + s.places.length, 0);
  const explained = stops.reduce((n, s) => n + [...s.openers, ...s.sponsors, ...s.places].length, 0);
  tracer.end(
    "explain",
    `explanations on ${explained} of ${picksCount} picks; city copy by ${deps.model ? `model for ${modelCopies}/${stops.length} stops` : "template"}`,
  );

  // 4. Optional plain-LLM comparison.
  let withoutQloo: Plan["withoutQloo"];
  if (deps.withoutQloo && deps.model) {
    try {
      withoutQloo = await deps.model.planWithoutQloo(withoutQlooPrompt(input, ctx.pool), opts.signal);
    } catch {
      withoutQloo = undefined;
    }
  }

  // 5. Assemble, validate, persist, stream.
  const act = state.act!;
  const momentum: Momentum = state.momentum ?? { trend: "unknown", status: "empty" };
  const trace = tracer.steps.map((s) => ({ ...s, calls: [...s.calls] }));
  const plan = Plan.parse({
    id: opts.id ?? nanoid(10),
    createdAt: new Date(deps.now()).toISOString(),
    input,
    act,
    momentum,
    candidates: state.candidates ?? [],
    stops,
    trace,
    summary: {
      qlooCallTypes: tracer.callTypes.size,
      qlooCalls: tracer.calls,
      untappedStops: stops.filter((s) => s.city.quadrant === "untapped").length,
      overallStatus: overallStatus(trace, state.actResolved),
    },
    withoutQloo,
  });
  try {
    await deps.save(plan);
  } catch (err) {
    console.warn("[runPlan] save failed:", err instanceof Error ? err.message : err);
  }
  emit({ type: "done", plan });
  return plan;
}

export type { StepId };
