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
import { Plan, PlanInput, type ActType, type ChangeSet, type CityPoolEntry, type CityScore, type Demographics, type Momentum, type Pick as PickT, type PlanEvent, type Stop, type ToolStatus, type TraceStep } from "@/lib/types";
import { matchesCity } from "@/lib/routing";
import { isReorderOnly, reorderStops } from "@/lib/revision";
import { suggestCapacity } from "@/lib/economics";
import { createProvenance, provenanceFor, safePlanForDisplay } from "@/lib/provenance";
import { sameComparisonBrief, validateWithoutQloo } from "./comparison";
import { cityPoolFor, spreadPick } from "./pool";
import { agentPrompt, AGENT_INSTRUCTIONS, withoutQlooPrompt } from "./prompts";
import { createAnthropicModel, promptCacheEnabled, UsageMeter, type AgentModel, type StopCopy } from "./model";
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
  /**
   * The plan this run revises. The result gets a new id, `parentId`, `revision` and `revisionNote`; the parent is never
   * written. A reorder-only change-set clones the parent (no Qloo, no model); anything else skips the agent loop and
   * lets the orchestrator re-plan under the new constraints, reusing the parent's act, picks and city copy where they
   * still apply (Qloo answers come from the response cache).
   */
  baseline?: Plan;
  /** The change-set that produced `rawInput` from the baseline's input. Decides clone vs full revision. */
  changes?: ChangeSet;
  /** One line naming what changed, stored on the plan (see describeChanges/revisionNote). */
  revisionNote?: string;
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

const QUADRANT_LABEL: Record<CityScore["quadrant"], string> = {
  untapped: "high-affinity, lower-popularity candidate",
  established: "high-affinity, higher-popularity candidate",
  reach: "lower-affinity candidate",
};

/** Announce lead time in weeks: untapped markets need a longer runway; momentum shortens or lengthens it. */
export function announceWeeks(quadrant: CityScore["quadrant"], trend: Momentum["trend"]): [number, number] {
  const base: Record<CityScore["quadrant"], [number, number]> = { untapped: [10, 12], reach: [8, 10], established: [6, 8] };
  const shift = trend === "rising" ? -2 : trend === "falling" ? 2 : 0;
  const [a, b] = base[quadrant];
  return [Math.max(4, a + shift), Math.max(5, b + shift)];
}

function toPick(e: RelatedEntity, reason: string, overlap?: number): PickT {
  return { id: e.id, name: e.name, tasteSimilarity: overlap, reason, tags: e.tags.slice(0, 4) };
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
      const base = has
        ? `Derived taste similarity ${ov.overlap.toFixed(2)} from compare results for ${act.name}; not a percentage of shared fans.`
        : `Related-act candidate from taste-affinity results for ${act.name}; local connection and availability need verification.`;
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
          `Brand-affinity candidate for ${act.name}'s overall audience${ages.length ? `; act-wide age scores over-index for ${ages.join(" and ")}` : ""}. Sponsorship interest is unverified.`,
      ),
    );
  const placeItems = state.places.get(city.id)?.items ?? [];
  const venueTagNames = state.venueTags.map((t) => t.name);
  const places = (picks.placeIds ?? [])
    .map((id) => placeItems.find((e) => e.id === id))
    .filter((e): e is RelatedEntity => Boolean(e))
    .map((e) =>
      toPick(e, e.explanation ?? `Place-affinity candidate for ${act.name}, requested around ${city.name}${venueTagNames.length ? ` with a ${venueTagNames.slice(0, 2).join(" / ")} brief` : ""}. Location, suitability and availability need checking.`),
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
  const trend = state.momentum?.trend ?? "unknown";
  const [w1, w2] = announceWeeks(city.quadrant, trend);
  return {
    act: act.name,
    actType: act.type,
    city: city.name,
    country: city.country,
    qloo: {
      dataMode: ctx.qloo.mode ?? "unknown",
      heatmapComparability: "unverified",
      demographicsScope: "act-wide",
      affinity: city.affinity,
      popularity: city.popularity,
      topAgeBuckets: topAgeBuckets(demo),
      femaleScoreVsBaseline: demo.gender.female,
      momentum: trend,
    },
    soundcheck: {
      heuristicRank: city.affinityRank,
      citiesScored: cands.length,
      quadrant: city.quadrant,
      quadrantLabel: QUADRANT_LABEL[city.quadrant],
      underserved: city.underserved,
      suggestedCapacity: suggestCapacity(city, act.popularity ?? 0.5),
      capacityBasis: "Unvalidated room-size planning assumption; not a forecast of ticket demand",
      timingBasis: "Heuristic announcement window; no booking or availability data",
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
  const angles: string[] = ["recorded affinity and popularity; cross-city comparability is unverified"];
  if (topAgeBuckets(demo).length) angles.push("the act-wide age buckets that over-index (not a local audience profile)");
  if (trend === "rising" || trend === "falling") angles.push("momentum");
  if (legDays > 0) angles.push("the travel days from the previous stop and why the routing works");
  angles.push("provisional heuristic selection; affinity and popularity are separate indices");
  return angles[(order - 1) % angles.length];
}

type Facts = ReturnType<typeof copyFacts>;

export function templateCopy(f: Facts): StopCopy {
  const cap = f.soundcheck.suggestedCapacity.toLocaleString("en-US");
  return {
    suggestion: `Room-size assumption: ${cap} capacity; validate demand before booking.`,
    whyHere: `${f.qloo.dataMode === "mock" ? "Synthetic example" : "Provisional heuristic candidate"}: ${f.city} has recorded affinity ${f.qloo.affinity} and popularity ${f.qloo.popularity}; cross-city comparability is unverified.`,
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

/** A numeric whitelist cannot validate claims: require explicit limits and reject known unsupported interpretations. */
export function copyMeetsEvidenceLimits(copy: StopCopy): boolean {
  const text = `${copy.suggestion} ${copy.whyHere}`;
  return /assumption/i.test(copy.suggestion) && /unverified/i.test(copy.whyHere) &&
    !/\b(?:audience overlap|fan(?:base)? overlap|median|sold out|sells? \d|nobody (?:has )?(?:played|booked)|guaranteed)\b/i.test(text);
}

/* -------------------------------------------------------------------- run */

function overallStatus(steps: { id: string; status: ToolStatus }[], actResolved: boolean): ToolStatus {
  const data = steps.filter((s) => s.id !== "agent" && s.id !== "guard");
  if (!actResolved || data.some((s) => s.status === "degraded")) return "degraded";
  return data.every((s) => s.status === "ok") ? "ok" : "partial";
}

/** Lineage fields for a revision; empty for an original run so its plan shape is unchanged. */
function lineage(baseline: Plan | undefined, note: string | undefined): Pick<Plan, "parentId" | "revision" | "revisionNote"> {
  if (!baseline) return {};
  return { parentId: baseline.id, revision: (baseline.revision ?? 1) + 1, ...(note ? { revisionNote: note } : {}) };
}

/** A new id for the run. A revision never reuses its parent's id. */
function planId(opts: RunOptions): string {
  return opts.id !== undefined && opts.id !== opts.baseline?.id ? opts.id : nanoid(10);
}

/**
 * Reorder-only revision: the same cities in a hand-made order. Clones the parent with stops renumbered and travel
 * days recomputed. No Qloo call, no model call; every Qloo figure on the plan is the parent's.
 */
async function cloneReordered(input: PlanInput, baseline: Plan, order: string[], emit: (e: PlanEvent) => void, opts: RunOptions): Promise<Plan> {
  const now = opts.deps?.now ?? Date.now;
  const save = opts.deps?.save ?? putPlan;
  const startedAt = now();
  const stops = reorderStops(structuredClone(baseline.stops), order);
  const step: TraceStep = {
    id: "revise",
    name: "Revise",
    status: "ok",
    summary: "Reordered by hand; Qloo data carried over from the previous revision",
    calls: [],
    startedAt,
    endedAt: now(),
  };
  const act = structuredClone(baseline.act);
  const provenance = provenanceFor(baseline);
  const comparison = baseline.withoutQloo?.protocolVersion === 2 && sameComparisonBrief(input, baseline.input)
    ? validateWithoutQloo(baseline.withoutQloo, input, opts.deps?.pool ?? cityPoolFor(input.region)) : undefined;
  if (baseline.withoutQloo && !comparison?.ok) step.summary += "; saved comparison omitted because its brief or protocol no longer matches";
  const candidates = structuredClone(baseline.candidates);
  const momentum = structuredClone(baseline.momentum);
  emit({ type: "provenance", provenance });
  emit({ type: "act", act });
  emit({ type: "candidates", candidates });
  emit({ type: "momentum", momentum });
  emit({ type: "step", step });
  for (const stop of stops) emit({ type: "stop", stop });
  const plan = Plan.parse({
    id: planId(opts),
    createdAt: new Date(now()).toISOString(),
    ...lineage(baseline, opts.revisionNote),
    input,
    provenance,
    act,
    momentum,
    candidates,
    stops,
    trace: [...structuredClone(baseline.trace), step],
    summary: {
      qlooCallTypes: baseline.summary.qlooCallTypes,
      qlooCalls: baseline.summary.qlooCalls,
      untappedStops: stops.filter((s) => s.city.quadrant === "untapped").length,
      overallStatus: baseline.summary.overallStatus,
    },
    // A changed manual order changes the comparison brief. Never carry a now-unmatched baseline forward.
    withoutQloo: comparison?.ok ? { ...comparison.value, protocolVersion: 2 } : undefined,
  });
  try {
    await save(plan);
  } catch (err) {
    console.warn("[runPlan] save failed:", err instanceof Error ? err.message : err);
  }
  emit({ type: "done", plan });
  return plan;
}

/**
 * Full revision, in place of the agent loop: carry the parent's resolved act over (so the guard does not re-resolve
 * it, possibly to a different candidate) and seed the parent's picks for every city still in the pool, so the guard
 * only picks for cities that are new on the route.
 */
function seedFromBaseline(ctx: RunContext, baseline: Plan): string {
  const { state, tracer } = ctx;
  state.act = structuredClone(baseline.act);
  state.actResolved = Boolean(baseline.act.id);
  ctx.emit({ type: "act", act: { ...state.act, tasteTags: [...state.act.tasteTags] } });
  tracer.begin("resolve", "Resolve act");
  if (!state.actResolved) tracer.mark("resolve", "degraded");
  tracer.end("resolve", `Carried over from the previous revision: "${state.act.name}"`);
  let seeded = 0;
  for (const s of baseline.stops) {
    if (!ctx.pool.some((c) => c.id === s.city.id)) continue;
    state.picks.set(s.city.id, {
      openerIds: s.openers.map((p) => p.id),
      sponsorIds: s.sponsors.map((p) => p.id),
      placeIds: s.places.map((p) => p.id),
      by: "model",
    });
    seeded++;
  }
  return `${seeded} stop${seeded === 1 ? "" : "s"}' picks carried over`;
}

/** The cities a full revision scores: the parent's candidates still in the pool, plus restored and locked cities. */
function revisionField(ctx: RunContext, baseline: Plan): string[] {
  const inPool = (id: string) => ctx.pool.some((c) => c.id === id);
  const restored = ctx.pool.filter((c) => baseline.input.excludedCities.some((k) => matchesCity(c, k))).map((c) => c.id);
  const locked = ctx.pool.filter((c) => ctx.input.lockedCities.some((k) => matchesCity(c, k))).map((c) => c.id);
  const parentField = [...baseline.candidates.map((c) => c.id), ...baseline.stops.map((s) => s.city.id)];
  return [...new Set([...parentField, ...restored, ...locked])].filter(inPool);
}

/**
 * Picks for a revised stop whose city was on the parent route. The parent's picks are rebuilt from this run's data;
 * a category where a saved pick no longer appears in returned candidates must drop it rather than replay old evidence.
 */
export async function runPlan(rawInput: PlanInput, emit: (e: PlanEvent) => void, opts: RunOptions = {}): Promise<Plan> {
  const input = PlanInput.parse(rawInput);
  const baseline = opts.baseline ? safePlanForDisplay(opts.baseline) : undefined;
  if (baseline && opts.changes && isReorderOnly(opts.changes, baseline)) {
    return cloneReordered(input, baseline, opts.changes.order!, emit, opts);
  }
  const deps = resolveDeps(input, opts.deps);
  const qloo = deps.qloo;
  const provenance = createProvenance(qloo.mode ?? "unknown");
  emit({ type: "provenance", provenance });
  // Live/mocked ids and evidence cannot be mixed by revising a stored plan after the backend mode changes.
  const reusableBaseline = baseline && provenanceFor(baseline).dataMode === qloo.mode ? baseline : undefined;
  const excluded = (c: CityPoolEntry) => input.excludedCities.some((k) => matchesCity(c, k));
  const tracer = new Tracer(emit, deps.now);
  const ctx: RunContext = { input, qloo, pool: deps.pool.filter((c) => !excluded(c)), tracer, state: newRunState(), emit, profile: deps.profile };
  const meter = deps.model ? new UsageMeter(deps.model.id, promptCacheEnabled()) : undefined;

  if (reusableBaseline) {
    // 1'. Revision: no agent loop. The constraints are already decided by the user; the orchestrator re-plans.
    tracer.begin("agent", "Revise");
    const carried = seedFromBaseline(ctx, reusableBaseline);
    // Re-score the parent's candidate cities (plus any restored or locked city it never scored) rather than the whole
    // pool: the same field keeps the route stable apart from the requested change, and every probe is a cache hit.
    const field = revisionField(ctx, reusableBaseline);
    if (field.length) await probeCities(ctx, field, "act");
    tracer.end(
      "agent",
      `Revision of ${reusableBaseline.id}${opts.revisionNote ? `: ${opts.revisionNote}` : ""}. Constraints applied by the orchestrator; Qloo answers reused from cache; ${carried}; ${field.length} cities re-scored`,
    );
  } else {
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
          meter,
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
  }
  opts.signal?.throwIfAborted();

  // 2. Coverage guard.
  const filled: string[] = [];
  const filledItems = new Set<CoverageItem>();
  await ensureCoverage(ctx, (item, detail) => {
    if (filled.length === 0) tracer.begin("guard", "Coverage guard");
    filled.push(detail);
    filledItems.add(item);
  });
  if (filled.length) {
    tracer.end("guard", baseline ? `Revision: orchestrator ${filled.join("; ")}` : `Model skipped ${[...filledItems].join(", ")}; orchestrator ${filled.join("; ")}`);
  }

  // Picture, description and links for the act (started when the act resolved; bounded by its own timeouts).
  await ctx.state.profilePromise;

  // 3. Stops and copy. A revised stop with the same city, previous city and travel days keeps the parent's copy.
  const { state } = ctx;
  const order = state.route?.order ?? [];
  const legDays = state.route?.legDays ?? [];
  const parentStops = [...(reusableBaseline?.stops ?? [])].sort((a, b) => a.order - b.order);
  const parentBy = new Map(parentStops.map((s, i) => [s.city.id, { stop: s, prev: i ? parentStops[i - 1].city.id : null }]));
  tracer.begin("explain", "Explain picks");
  let modelCopies = 0;
  let reusedCopies = 0;
  const stops: Stop[] = new Array(order.length);
  // Stops stream in tour order: each is emitted as soon as it and every earlier stop is ready.
  let flushed = 0;
  const flush = () => {
    while (flushed < stops.length && stops[flushed]) emit({ type: "stop", stop: stops[flushed++] });
  };
  await mapLimit(order, 4, async (city, i) => {
    const demo = stopDemographics(ctx, city.id);
    const days = legDays[i] ?? 0;
    const parent = parentBy.get(city.id);
    const sameLeg = parent && reusableBaseline?.provenance?.proseVersion === 2 &&
      reusableBaseline.input.window === input.window && reusableBaseline.input.budgetTier === input.budgetTier &&
      parent.prev === (i ? order[i - 1].id : null) && parent.stop.legDays === days;
    let copy: StopCopy;
    if (sameLeg) {
      copy = { suggestion: parent.stop.suggestion, whyHere: parent.stop.whyHere };
      reusedCopies++;
    } else {
      const facts = copyFacts(ctx, city, days, demo, i + 1);
      copy = templateCopy(facts);
      if (deps.model) {
        try {
          const signal = opts.signal ? AbortSignal.any([AbortSignal.timeout(30_000), opts.signal]) : AbortSignal.timeout(30_000);
          const c = await deps.model.writeStopCopy(facts, signal, meter);
          if (copyUsesOnlyGivenNumbers(c, facts) && copyMeetsEvidenceLimits(c)) {
            copy = c;
            modelCopies++;
          }
        } catch {
          // keep the template
        }
      }
    }
    // Keep only picks supported by this run's returned candidates, never stale saved recommendations.
    const picks = buildPicks(ctx, city);
    const stop: Stop = { order: i + 1, city, legDays: days, demographics: demo, ...picks, ...copy };
    stops[i] = stop;
    flush();
  });
  const picksCount = stops.reduce((n, s) => n + s.openers.length + s.sponsors.length + s.places.length, 0);
  const explained = stops.reduce((n, s) => n + [...s.openers, ...s.sponsors, ...s.places].length, 0);
  const copySummary = baseline
    ? `city copy: ${reusedCopies} reused from the previous revision, ${modelCopies} by model, ${stops.length - reusedCopies - modelCopies} by template`
    : `city copy by ${deps.model ? `model for ${modelCopies}/${stops.length} stops` : "template"}`;
  tracer.end("explain", `explanations on ${explained} of ${picksCount} picks; ${copySummary}`);

  // 4. Optional plain-LLM comparison, retained only for the same validated comparison brief.
  let withoutQloo: Plan["withoutQloo"];
  if (baseline?.withoutQloo) {
    const checked = baseline.withoutQloo.protocolVersion === 2 && sameComparisonBrief(input, baseline.input) &&
      deps.model && baseline.summary.model?.id === deps.model.id
      ? validateWithoutQloo(baseline.withoutQloo, input, ctx.pool) : undefined;
    if (checked?.ok) withoutQloo = { ...checked.value, protocolVersion: 2 };
    else {
      tracer.begin("comparison", "Comparison baseline");
      tracer.mark("comparison", "degraded");
      tracer.end("comparison", checked && !checked.ok ? `Saved comparison omitted: ${checked.reason}` : "Saved comparison omitted: planning brief changed, model identity differs, or comparison protocol is unverified");
    }
  } else if (!baseline && deps.withoutQloo && deps.model) {
    tracer.begin("comparison", "Comparison baseline");
    try {
      const candidate = await deps.model.planWithoutQloo(withoutQlooPrompt(input, ctx.pool), opts.signal, meter);
      const checked = validateWithoutQloo(candidate, input, ctx.pool);
      if (checked.ok) {
        withoutQloo = { ...checked.value, protocolVersion: 2 };
        tracer.end("comparison", "Matched brief; city count, candidate pool, locks, exclusions and applicable order checked. One model call without Qloo; tool and compute budgets differ.");
      }
      else {
        tracer.mark("comparison", "degraded");
        tracer.end("comparison", `Comparison omitted: ${checked.reason}`);
      }
    } catch {
      withoutQloo = undefined;
      tracer.mark("comparison", "degraded");
      tracer.end("comparison", "Comparison omitted: baseline generation or output validation failed");
    }
  }

  // 5. Assemble, validate, persist, stream.
  const act = state.act!;
  const momentum: Momentum = state.momentum ?? { trend: "unknown", status: "empty" };
  const trace = tracer.steps.map((s) => ({ ...s, calls: [...s.calls] }));
  const plan = Plan.parse({
    id: planId(opts),
    createdAt: new Date(deps.now()).toISOString(),
    ...lineage(baseline, opts.revisionNote),
    input,
    provenance,
    act,
    momentum,
    candidates: state.candidates ?? [],
    stops,
    trace,
    summary: {
      qlooCallTypes: tracer.callTypes.size,
      qlooCalls: tracer.calls,
      untappedStops: stops.filter((s) => s.city.quadrant === "untapped").length,
      model: meter?.usage,
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
