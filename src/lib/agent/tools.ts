/**
 * Agent tools. Three layers:
 * - Tracer: the visible agent trace (one TraceStep per phase, every Qloo call recorded with its redacted request).
 * - Actions: deterministic, idempotent operations over a shared RunState. Both the LLM (through tool specs) and the
 *   orchestrator's coverage guard call these, so a step the model skipped is filled by exactly the same code.
 * - Tool specs: zod-typed wrappers the model calls. Outputs are compact JSON so the loop stays cheap.
 * Nothing here throws on thin data: Qloo envelopes are recorded and degraded, and a thrown client error becomes "error".
 */
import { z } from "zod";
import type {
  CityHeatmap,
  CompareData,
  DemographicsData,
  EntityCandidate,
  QlooClient,
  RelatedEntity,
  TagRef,
} from "@/lib/qloo/contract";
import {
  Act,
  ActType,
  type CityPoolEntry,
  type CityScore,
  type Demographics,
  type Momentum,
  type PlanEvent,
  type PlanInput,
  type ToolMeta,
  type ToolResult,
  type ToolStatus,
  type TraceStep,
} from "@/lib/types";
import { scoreCities, type ScorableHeatmap } from "@/lib/score";
import { mergeProfile, type ActProfile } from "@/lib/actProfile";
import { matchesCity, routeTour } from "@/lib/routing";

/* ------------------------------------------------------------------ tracer */

export type StepId =
  | "agent"
  | "resolve"
  | "taste"
  | "score"
  | "momentum"
  | "profile"
  | "route"
  | "openers"
  | "sponsors"
  | "places"
  | "explain"
  | "guard";

/** Human label used when a call throws before the client could produce its own redacted request string. */
const CALL_LABEL: Record<keyof QlooClient, string> = {
  searchEntity: "GET /search",
  findTags: "GET /v2/tags",
  heatmapForCity: "GET /v2/insights?filter.type=urn:heatmap",
  demographics: "GET /v2/insights?filter.type=urn:demographics",
  trending: "GET /v2/trending",
  relatedActs: "GET /v2/insights?filter.type=[act type]",
  compareAudiences: "GET /v2/analysis/compare",
  brands: "GET /v2/insights?filter.type=urn:entity:brand",
  places: "GET /v2/insights?filter.type=urn:entity:place",
  tasteTags: "GET /v2/insights?filter.type=urn:tag",
};

export function aggregateStatus(statuses: ToolStatus[]): ToolStatus {
  if (statuses.length === 0) return "ok";
  const all = (s: ToolStatus) => statuses.every((x) => x === s);
  if (all("ok")) return "ok";
  if (all("error")) return "error";
  if (all("empty")) return "empty";
  if (statuses.includes("degraded")) return "degraded";
  return "partial";
}

export class Tracer {
  readonly steps: TraceStep[] = [];
  readonly callTypes = new Set<string>();
  calls = 0;
  private sticky = new Map<string, ToolStatus>();

  constructor(
    private readonly emit: (e: PlanEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  private find(id: StepId) {
    return this.steps.find((s) => s.id === id);
  }

  private publish(step: TraceStep) {
    this.emit({ type: "step", step: { ...step, calls: step.calls.map((c) => ({ ...c })) } });
  }

  private computeStatus(step: TraceStep): ToolStatus {
    const agg = aggregateStatus(step.calls.map((c) => c.status));
    const forced = this.sticky.get(step.id);
    if (forced && agg !== "error" && agg !== "empty") return forced;
    return agg;
  }

  /** Starts a step, or re-opens it if it already ran (e.g. the guard adds calls to a step the model began). */
  begin(id: StepId, name: string): TraceStep {
    let step = this.find(id);
    if (!step) {
      step = { id, name, status: "ok", summary: "", calls: [], startedAt: this.now() };
      this.steps.push(step);
    } else {
      step.name = name;
      step.endedAt = undefined;
    }
    this.publish(step);
    return step;
  }

  record(id: StepId, callType: string, meta: ToolMeta, status: ToolStatus) {
    const step = this.find(id) ?? this.begin(id, id);
    step.calls.push({ request: meta.request, status, ms: Math.round(meta.ms), cached: meta.cached });
    this.callTypes.add(callType);
    this.calls += 1;
    const next = this.computeStatus(step);
    if (next !== step.status) {
      step.status = next;
      this.publish(step);
    }
  }

  /** Forces a status that survives later calls (used for "degraded" thin-data fallbacks and model outages). */
  mark(id: StepId, status: ToolStatus) {
    this.sticky.set(id, status);
    const step = this.find(id);
    if (step) {
      const next = this.computeStatus(step);
      if (next !== step.status) {
        step.status = next;
        this.publish(step);
      }
    }
  }

  end(id: StepId, summary: string, name?: string) {
    const step = this.find(id) ?? this.begin(id, name ?? id);
    if (name) step.name = name;
    step.summary = summary;
    step.status = this.computeStatus(step);
    step.endedAt = this.now();
    this.publish(step);
  }

  get(id: StepId): TraceStep | undefined {
    return this.find(id);
  }
}

/* --------------------------------------------------------------- run state */

export interface HeatmapEntry {
  heatmap: CityHeatmap;
  status: ToolStatus;
  seed: "act" | "tags";
}

export interface StopPicks {
  openerIds?: string[];
  sponsorIds?: string[];
  placeIds?: string[];
  by: "model" | "guard";
}

export interface BrandSet {
  ageBuckets: string[];
  items: RelatedEntity[];
  status: ToolStatus;
}

export interface RunState {
  actCandidates: EntityCandidate[];
  actSearched: boolean;
  act?: Act;
  actResolved: boolean;
  /** In-flight profile lookup (picture, description, links); see startActProfile. */
  profilePromise?: Promise<void>;
  tasteTagsFetched: boolean;
  tasteTagRefs: TagRef[];
  seedTags: TagRef[];
  seedTagsTried: boolean;
  venueTags: TagRef[];
  venueTagsTried: boolean;
  heatmaps: Map<string, HeatmapEntry>;
  /** Cities whose act-seeded heatmap came back empty. */
  thinCities: Set<string>;
  candidates?: CityScore[];
  globalDemographics?: { data: DemographicsData; status: ToolStatus };
  cityDemographics: Map<string, Demographics>;
  momentum?: Momentum;
  extraLocked: string[];
  route?: { order: CityScore[]; legDays: number[] };
  routeNotes: string[];
  openers: Map<string, { items: RelatedEntity[]; status: ToolStatus }>;
  overlaps: Map<string, { overlap: number; sharedTags: string[]; status: ToolStatus }>;
  brandSets: BrandSet[];
  places: Map<string, { items: RelatedEntity[]; status: ToolStatus }>;
  picks: Map<string, StopPicks>;
}

export function newRunState(): RunState {
  return {
    actCandidates: [],
    actSearched: false,
    actResolved: false,
    tasteTagsFetched: false,
    tasteTagRefs: [],
    seedTags: [],
    seedTagsTried: false,
    venueTags: [],
    venueTagsTried: false,
    heatmaps: new Map(),
    thinCities: new Set(),
    cityDemographics: new Map(),
    extraLocked: [],
    routeNotes: [],
    openers: new Map(),
    overlaps: new Map(),
    brandSets: [],
    places: new Map(),
    picks: new Map(),
  };
}

export interface RunContext {
  input: PlanInput;
  qloo: QlooClient;
  /** Candidate pool for the region with excluded cities already removed. */
  pool: CityPoolEntry[];
  tracer: Tracer;
  state: RunState;
  emit: (e: PlanEvent) => void;
  /** Online act profile lookup (picture, description, links). Tests inject a stub. */
  profile: (name: string, type: ActType) => Promise<ActProfile | null>;
}

/* ----------------------------------------------------------------- helpers */

const r2 = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined);
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Calls one Qloo method, records it on the trace, and converts a throw into an "error" envelope. */
async function q<K extends keyof QlooClient, T>(
  ctx: RunContext,
  step: StepId,
  type: K,
  fallback: T,
  call: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const t0 = Date.now();
  let res: ToolResult<T>;
  try {
    res = await call();
    if (!res || typeof res !== "object") throw new Error("malformed tool result");
    res = { status: res.status ?? "error", data: res.data ?? fallback, meta: res.meta ?? { request: CALL_LABEL[type], ms: Date.now() - t0, cached: false } };
  } catch (err) {
    res = {
      status: "error",
      data: fallback,
      meta: { request: CALL_LABEL[type], ms: Date.now() - t0, cached: false, note: err instanceof Error ? err.message : String(err) },
    };
  }
  ctx.tracer.record(step, type, res.meta, res.status);
  return res;
}

export function findCity(ctx: RunContext, key: string): CityPoolEntry | undefined {
  return ctx.pool.find((c) => matchesCity(c, key));
}

function okish(s: ToolStatus) {
  return s === "ok" || s === "partial" || s === "degraded";
}

function actSeed(ctx: RunContext): { entityIds?: string[]; tagIds?: string[] } {
  const a = ctx.state.act;
  if (a?.id && ctx.state.actResolved) return { entityIds: [a.id] };
  return { tagIds: ctx.state.seedTags.map((t) => t.id) };
}

function hasEntity(ctx: RunContext): boolean {
  return Boolean(ctx.state.act?.id && ctx.state.actResolved);
}

/* ----------------------------------------------------------------- actions */

export async function searchAct(ctx: RunContext, query: string, type: ActType) {
  ctx.tracer.begin("resolve", "Resolve act");
  const res = await q(ctx, "resolve", "searchEntity", [] as EntityCandidate[], () => ctx.qloo.searchEntity(query, type));
  ctx.state.actSearched = true;
  for (const cand of res.data) if (!ctx.state.actCandidates.some((c) => c.id === cand.id)) ctx.state.actCandidates.push(cand);
  ctx.tracer.end("resolve", `${res.data.length} candidate${res.data.length === 1 ? "" : "s"} for the act`);
  return res;
}

function toAct(c: EntityCandidate, fallbackType: ActType): Act {
  const imageOk = c.imageUrl && z.string().url().safeParse(c.imageUrl).success;
  return Act.parse({
    id: c.id,
    name: c.name,
    type: ActType.safeParse(c.type).success ? c.type : fallbackType,
    subtype: c.subtype,
    popularity: typeof c.popularity === "number" ? clamp01(c.popularity) : undefined,
    imageUrl: imageOk ? c.imageUrl : undefined,
    description: c.description,
    links: (c.links ?? []).filter((l) => z.string().url().safeParse(l.url).success),
    tasteTags: [],
  });
}

/**
 * Picture, description and links for the resolved act, fetched online (Qloo first, Wikipedia/Wikidata as fallback).
 * Runs in the background: the act event is re-emitted once the profile lands, and runPlan awaits it before saving.
 */
export function startActProfile(ctx: RunContext): void {
  const act = ctx.state.act;
  if (!act || ctx.state.profilePromise) return;
  ctx.state.profilePromise = ctx
    .profile(act.name, act.type)
    .then((profile) => {
      const current = ctx.state.act;
      if (!current || !profile) return;
      const merged = mergeProfile({ imageUrl: current.imageUrl, description: current.description, links: current.links }, profile);
      ctx.state.act = { ...current, ...merged };
      ctx.emit({ type: "act", act: { ...ctx.state.act, tasteTags: [...ctx.state.act.tasteTags] } });
    })
    .catch(() => undefined);
}

/** Picks the candidate: explicit id, else input.actId, else exact name match, else the first result. */
export function confirmAct(ctx: RunContext, entityId?: string): { act?: Act; error?: string } {
  if (ctx.state.act) return { act: ctx.state.act, error: ctx.state.act.id === entityId ? undefined : "act already confirmed" };
  const cands = ctx.state.actCandidates;
  const wanted = entityId ?? ctx.input.actId;
  const norm = (s: string) => s.trim().toLowerCase();
  const pick =
    (wanted && cands.find((c) => c.id === wanted)) ||
    (!entityId && cands.find((c) => norm(c.name) === norm(ctx.input.actQuery))) ||
    (!entityId && cands[0]) ||
    undefined;
  if (!pick) return { error: entityId ? `unknown candidate id ${entityId}` : "no candidates" };
  ctx.state.act = toAct(pick, ctx.input.actType);
  ctx.state.actResolved = true;
  ctx.emit({ type: "act", act: { ...ctx.state.act, tasteTags: [...ctx.state.act.tasteTags] } });
  startActProfile(ctx);
  ctx.tracer.end("resolve", `Resolved "${pick.name}" (${pick.hint})`);
  return { act: ctx.state.act };
}

/** Guard path: search if needed, confirm, and fall back to an unresolved act built from the query. */
export async function ensureAct(ctx: RunContext): Promise<Act> {
  if (ctx.state.act) return ctx.state.act;
  if (!ctx.state.actSearched || ctx.state.actCandidates.length === 0) await searchAct(ctx, ctx.input.actQuery, ctx.input.actType);
  const { act } = confirmAct(ctx);
  if (act) return act;
  ctx.state.act = Act.parse({ id: ctx.input.actId ?? "", name: ctx.input.actQuery, type: ctx.input.actType, tasteTags: [] });
  ctx.state.actResolved = Boolean(ctx.input.actId);
  ctx.tracer.mark("resolve", "degraded");
  ctx.tracer.end("resolve", ctx.state.actResolved ? "Search empty; using the supplied Qloo id" : "No Qloo match; planning from taste tags only");
  ctx.emit({ type: "act", act: { ...ctx.state.act, tasteTags: [] } });
  startActProfile(ctx);
  return ctx.state.act;
}

export async function fetchTasteTags(ctx: RunContext, take = 12): Promise<TagRef[]> {
  const act = await ensureAct(ctx);
  if (ctx.state.tasteTagsFetched) return ctx.state.tasteTagRefs;
  ctx.tracer.begin("taste", "Taste profile");
  ctx.state.tasteTagsFetched = true;
  if (!hasEntity(ctx)) {
    ctx.tracer.end("taste", "Skipped: act not resolved in Qloo");
    return [];
  }
  const res = await q(ctx, "taste", "tasteTags", [] as TagRef[], () => ctx.qloo.tasteTags(act.id, { take }));
  ctx.state.tasteTagRefs = res.data;
  act.tasteTags = res.data.map((t) => t.name).slice(0, 12);
  ctx.tracer.end("taste", res.data.length ? `${res.data.length} taste tags: ${act.tasteTags.slice(0, 4).join(", ")}` : "No taste tags returned");
  return res.data;
}

/** Resolves tag ids for re-seeding thin heatmaps: the act's taste tags (or the given queries) through /v2/tags. */
export async function ensureSeedTags(ctx: RunContext, queries?: string[]): Promise<TagRef[]> {
  if (!queries && ctx.state.seedTagsTried) return ctx.state.seedTags;
  if (!queries) await fetchTasteTags(ctx);
  ctx.state.seedTagsTried = true;
  const names = queries ?? ctx.state.tasteTagRefs.slice(0, 3).map((t) => t.name);
  // Taste tags may already carry usable ids; prefer those when no explicit query was given.
  if (!queries) {
    for (const t of ctx.state.tasteTagRefs.slice(0, 3)) if (t.id && !ctx.state.seedTags.some((s) => s.id === t.id)) ctx.state.seedTags.push(t);
  }
  ctx.tracer.begin("taste", "Taste profile");
  for (const name of names) {
    const res = await q(ctx, "taste", "findTags", [] as TagRef[], () => ctx.qloo.findTags(name));
    const top = res.data[0];
    if (top && !ctx.state.seedTags.some((s) => s.id === top.id)) ctx.state.seedTags.push(top);
  }
  ctx.tracer.end("taste", `Seed tags: ${ctx.state.seedTags.map((t) => t.name).join(", ") || "none found"}`);
  return ctx.state.seedTags;
}

export async function findVenueTags(ctx: RunContext, queries: string[]): Promise<TagRef[]> {
  ctx.state.venueTagsTried = true;
  ctx.tracer.begin("places", "Local activations");
  for (const query of queries.slice(0, 4)) {
    const res = await q(ctx, "places", "findTags", [] as TagRef[], () => ctx.qloo.findTags(query, { typeHint: "urn:entity:place" }));
    for (const t of res.data.slice(0, 1)) if (!ctx.state.venueTags.some((v) => v.id === t.id)) ctx.state.venueTags.push(t);
  }
  return ctx.state.venueTags;
}

export function defaultVenueQueries(type: ActType): string[] {
  if (type === "person") return ["comedy club", "cocktail bar"];
  if (type === "podcast") return ["theater", "coffee shop"];
  return ["live music venue", "cocktail bar", "record store"];
}

export async function probeCities(ctx: RunContext, cityIds: string[], seed: "act" | "tags") {
  await ensureAct(ctx);
  const cities = cityIds.map((id) => findCity(ctx, id)).filter((c): c is CityPoolEntry => Boolean(c));
  const unknown = cityIds.filter((id) => !findCity(ctx, id));
  const useTags = seed === "tags" || !hasEntity(ctx);
  if (useTags) await ensureSeedTags(ctx);
  ctx.tracer.begin("score", "Score cities");
  const seedArg = useTags ? { tagIds: ctx.state.seedTags.map((t) => t.id) } : actSeed(ctx);
  const noSeedTags = useTags && ctx.state.seedTags.length === 0;
  const results = await mapLimit(cities, 4, async (city) => {
    const empty: CityHeatmap = { city, affinity: 0, affinityRank: 0, popularity: 0, cells: [] };
    const prev = ctx.state.heatmaps.get(city.id);
    if (noSeedTags) {
      // Nothing to re-seed with: record the attempt so the guard does not loop, keep any usable earlier result.
      if (!prev || !okish(prev.status)) ctx.state.heatmaps.set(city.id, { heatmap: prev?.heatmap ?? empty, status: "empty", seed: "tags" });
      return { cityId: city.id, status: "empty" as ToolStatus, affinity: 0, popularity: 0 };
    }
    const res = await q(ctx, "score", "heatmapForCity", empty, () => ctx.qloo.heatmapForCity(seedArg, city));
    const data: CityHeatmap = { ...empty, ...res.data, city };
    if (!useTags) {
      if (res.status === "empty") ctx.state.thinCities.add(city.id);
      const replace = !prev || prev.seed === "act" || okish(res.status) || !okish(prev.status);
      if (replace) ctx.state.heatmaps.set(city.id, { heatmap: data, status: res.status, seed: "act" });
    } else {
      const status: ToolStatus = okish(res.status) ? "degraded" : res.status;
      if (!prev || !okish(prev.status)) ctx.state.heatmaps.set(city.id, { heatmap: data, status, seed: "tags" });
      if (okish(res.status)) ctx.tracer.mark("score", "degraded");
    }
    return { cityId: city.id, status: res.status, affinity: r2(data.affinity), popularity: r2(data.popularity) };
  });
  ctx.tracer.end("score", `heatmap ×${ctx.state.heatmaps.size}${ctx.state.thinCities.size ? `, ${ctx.state.thinCities.size} thin` : ""}`, `Score ${ctx.state.heatmaps.size} cities`);
  return { results, unknown, seed: useTags ? "tags" : "act" };
}

/** Cities whose act seed was empty and that have not been re-seeded by tags yet. */
export function pendingThinCities(ctx: RunContext): string[] {
  return [...ctx.state.thinCities].filter((id) => ctx.state.heatmaps.get(id)?.seed !== "tags");
}

export function score(ctx: RunContext): CityScore[] {
  const rows: ScorableHeatmap[] = ctx.pool
    .filter((c) => ctx.state.heatmaps.has(c.id))
    .map((c) => {
      const e = ctx.state.heatmaps.get(c.id)!;
      return { ...e.heatmap, city: c, status: e.status };
    });
  ctx.state.candidates = scoreCities(rows);
  ctx.emit({ type: "candidates", candidates: ctx.state.candidates });
  const untapped = ctx.state.candidates.filter((c) => c.quadrant === "untapped").length;
  const step = ctx.tracer.get("score");
  ctx.tracer.end("score", `heatmap ×${rows.length}; ${untapped} primed but untapped${step?.status === "degraded" ? "; thin cities re-seeded by taste tags" : ""}`, `Score ${rows.length} cities`);
  return ctx.state.candidates;
}

export async function fetchMomentum(ctx: RunContext, weeks = 8): Promise<Momentum> {
  const act = await ensureAct(ctx);
  ctx.tracer.begin("momentum", "Check momentum");
  if (!hasEntity(ctx)) {
    ctx.state.momentum = { trend: "unknown", status: "empty" };
  } else {
    const res = await q(ctx, "momentum", "trending", { trend: "unknown" as const }, () => ctx.qloo.trending(act.id, act.type, { weeks }));
    ctx.state.momentum = { trend: res.data.trend ?? "unknown", velocity: r2(res.data.velocity), weeks: res.data.weeks ?? weeks, status: res.status };
  }
  ctx.emit({ type: "momentum", momentum: ctx.state.momentum });
  ctx.tracer.end("momentum", `trending ${ctx.state.momentum.weeks ?? weeks} weeks: ${ctx.state.momentum.trend}`);
  return ctx.state.momentum;
}

function toDemographics(data: DemographicsData | undefined, status: ToolStatus): Demographics {
  return {
    age: (data?.age ?? []).map((a) => ({ bucket: a.bucket, score: r2(a.score) ?? 0 })),
    gender: { female: r2(data?.gender?.female) ?? 0, male: r2(data?.gender?.male) ?? 0 },
    status,
  };
}

export async function fetchDemographics(ctx: RunContext, cityIds: string[] = []) {
  await ensureAct(ctx);
  ctx.tracer.begin("profile", "Profile markets");
  const empty: DemographicsData = { age: [], gender: { female: 0, male: 0 } };
  if (!ctx.state.globalDemographics) {
    const res = await q(ctx, "profile", "demographics", empty, () => ctx.qloo.demographics(actSeed(ctx)));
    ctx.state.globalDemographics = { data: res.data, status: res.status };
  }
  const cities = cityIds.map((id) => findCity(ctx, id)).filter((c): c is CityPoolEntry => !!c && !ctx.state.cityDemographics.has(c.id));
  await mapLimit(cities, 4, async (city) => {
    const res = await q(ctx, "profile", "demographics", empty, () => ctx.qloo.demographics(actSeed(ctx), { locationQuery: city.name }));
    const local = okish(res.status) && res.data.age.length > 0;
    const g = ctx.state.globalDemographics!;
    // Thin local data falls back to the act's overall audience profile, flagged as degraded.
    ctx.state.cityDemographics.set(city.id, local ? toDemographics(res.data, res.status) : toDemographics(g.data, okish(g.status) ? "degraded" : g.status));
  });
  ctx.tracer.end("profile", `demographics ×${1 + ctx.state.cityDemographics.size}`);
  return { global: toDemographics(ctx.state.globalDemographics.data, ctx.state.globalDemographics.status), cities: Object.fromEntries(ctx.state.cityDemographics) };
}

export function topAgeBuckets(d: Pick<Demographics, "age"> | DemographicsData | undefined, n = 2): string[] {
  return [...(d?.age ?? [])]
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((a) => a.bucket);
}

export function route(ctx: RunContext, stops?: number, alsoLock: string[] = []) {
  if (!ctx.state.candidates) score(ctx);
  for (const key of alsoLock) if (!ctx.state.extraLocked.includes(key)) ctx.state.extraLocked.push(key);
  ctx.tracer.begin("route", "Route tour");
  const locked = [...ctx.input.lockedCities, ...ctx.state.extraLocked];
  const notes: string[] = [];
  for (const key of locked) {
    if (!ctx.state.candidates!.some((c) => matchesCity(c, key))) notes.push(`${key} is not in the scored pool`);
  }
  const r = routeTour(ctx.state.candidates!, { stops: stops ?? ctx.input.stops, locked, excluded: ctx.input.excludedCities, order: ctx.input.order });
  ctx.state.route = r;
  ctx.state.routeNotes = notes;
  const days = r.legDays.reduce((a, b) => a + b, 0);
  ctx.tracer.end("route", `${r.order.length} stops, ${days} travel days${notes.length ? `; ${notes.join("; ")}` : ""}`);
  return r;
}

export async function fetchOpeners(ctx: RunContext, cityIds: string[], take = 8) {
  const act = await ensureAct(ctx);
  ctx.tracer.begin("openers", "Openers");
  const cities = cityIds.map((id) => findCity(ctx, id)).filter((c): c is CityPoolEntry => !!c && !ctx.state.openers.has(c.id));
  await mapLimit(cities, 4, async (city) => {
    if (!hasEntity(ctx)) {
      ctx.state.openers.set(city.id, { items: [], status: "empty" });
      return;
    }
    const res = await q(ctx, "openers", "relatedActs", [] as RelatedEntity[], () =>
      ctx.qloo.relatedActs(act.id, act.type, { locationQuery: city.name, take, explain: true }),
    );
    ctx.state.openers.set(city.id, { items: res.data.filter((e) => e.id !== act.id), status: res.status });
  });
  ctx.tracer.end("openers", `${act.type} ×${ctx.state.openers.size}, compare ×${ctx.state.overlaps.size}`);
  return Object.fromEntries(cityIds.map((id) => [id, ctx.state.openers.get(findCity(ctx, id)?.id ?? id)]));
}

export async function compareOpeners(ctx: RunContext, candidateIds: string[]) {
  const act = await ensureAct(ctx);
  ctx.tracer.begin("openers", "Openers");
  const todo = [...new Set(candidateIds)].filter((id) => !ctx.state.overlaps.has(id));
  await mapLimit(todo, 4, async (id) => {
    if (!hasEntity(ctx)) return;
    const res = await q(ctx, "openers", "compareAudiences", { overlap: 0, sharedTags: [] } as CompareData, () =>
      ctx.qloo.compareAudiences(act.id, id, act.type),
    );
    ctx.state.overlaps.set(id, { overlap: clamp01(res.data.overlap), sharedTags: res.data.sharedTags ?? [], status: res.status });
  });
  ctx.tracer.end("openers", `${act.type} ×${ctx.state.openers.size}, compare ×${ctx.state.overlaps.size}`);
  return Object.fromEntries(candidateIds.map((id) => [id, ctx.state.overlaps.get(id)]));
}

export async function fetchSponsors(ctx: RunContext, ageBuckets: string[] = [], take = 10) {
  const act = await ensureAct(ctx);
  ctx.tracer.begin("sponsors", "Sponsors");
  const key = [...ageBuckets].sort().join(",");
  const existing = ctx.state.brandSets.find((b) => [...b.ageBuckets].sort().join(",") === key);
  if (existing) return existing;
  let set: BrandSet;
  if (!hasEntity(ctx)) {
    set = { ageBuckets, items: [], status: "empty" };
  } else {
    const res = await q(ctx, "sponsors", "brands", [] as RelatedEntity[], () =>
      ctx.qloo.brands(act.id, { ageBuckets: ageBuckets.length ? ageBuckets : undefined, take, explain: true }),
    );
    set = { ageBuckets, items: res.data, status: res.status };
  }
  ctx.state.brandSets.push(set);
  ctx.tracer.end("sponsors", `brand ×${ctx.state.brandSets.length}${ageBuckets.length ? ` (ages ${ageBuckets.join(", ")})` : ""}`);
  return set;
}

export async function fetchPlaces(ctx: RunContext, cityIds: string[], minPopularity = 0.5) {
  const act = await ensureAct(ctx);
  ctx.tracer.begin("places", "Local activations");
  const tagIds = ctx.state.venueTags.map((t) => t.id);
  const cities = cityIds.map((id) => findCity(ctx, id)).filter((c): c is CityPoolEntry => !!c && !ctx.state.places.has(c.id));
  await mapLimit(cities, 4, async (city) => {
    if (!hasEntity(ctx)) {
      ctx.state.places.set(city.id, { items: [], status: "empty" });
      return;
    }
    const call = (minPop?: number) =>
      q(ctx, "places", "places", [] as RelatedEntity[], () =>
        ctx.qloo.places(act.id, { locationQuery: city.name, tagIds: tagIds.length ? tagIds : undefined, minPopularity: minPop, take: 8, explain: true }),
      );
    let res = await call(minPopularity);
    // Thin fallback: drop the popularity floor once before giving up on a city.
    if (res.status === "empty" && minPopularity > 0) {
      const retry = await call(undefined);
      if (okish(retry.status)) res = { ...retry, status: "degraded" };
    }
    ctx.state.places.set(city.id, { items: res.data, status: res.status });
  });
  const thin = [...ctx.state.places.values()].filter((p) => !okish(p.status)).length;
  ctx.tracer.end("places", `place ×${ctx.state.places.size}${thin ? `, ${thin} cities thin` : ""}; tags: ${ctx.state.venueTags.map((t) => t.name).join(", ") || "none"}`);
  return Object.fromEntries(cityIds.map((id) => [id, ctx.state.places.get(findCity(ctx, id)?.id ?? id)]));
}

export function finalizeStop(
  ctx: RunContext,
  cityId: string,
  picks: { openerIds: string[]; sponsorIds: string[]; placeIds: string[] },
  by: StopPicks["by"] = "model",
) {
  const city = findCity(ctx, cityId);
  if (!city) return { error: `unknown city ${cityId}` };
  const openerPool = new Set((ctx.state.openers.get(city.id)?.items ?? []).map((e) => e.id));
  const brandPool = new Set(ctx.state.brandSets.flatMap((b) => b.items.map((e) => e.id)));
  const placePool = new Set((ctx.state.places.get(city.id)?.items ?? []).map((e) => e.id));
  const keep = (ids: string[], pool: Set<string>) => [...new Set(ids)].filter((id) => pool.has(id));
  const rec: StopPicks = {
    openerIds: keep(picks.openerIds, openerPool).slice(0, 3),
    sponsorIds: keep(picks.sponsorIds, brandPool).slice(0, 3),
    placeIds: keep(picks.placeIds, placePool).slice(0, 3),
    by,
  };
  ctx.state.picks.set(city.id, rec);
  const dropped =
    picks.openerIds.length + picks.sponsorIds.length + picks.placeIds.length -
    (rec.openerIds!.length + rec.sponsorIds!.length + rec.placeIds!.length);
  return { cityId: city.id, kept: rec, dropped };
}

/* -------------------------------------------------------------- tool specs */

export interface AgentToolSpec {
  name: string;
  description: string;
  input: z.ZodType;
  run(input: unknown): Promise<unknown>;
}

function spec<S extends z.ZodType>(name: string, description: string, input: S, fn: (input: z.output<S>) => Promise<unknown> | unknown): AgentToolSpec {
  return {
    name,
    description,
    input,
    async run(raw: unknown) {
      const parsed = input.safeParse(raw);
      if (!parsed.success) return { error: "invalid input", issues: parsed.error.issues.slice(0, 3).map((i) => i.message) };
      try {
        return await fn(parsed.data);
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

const compactEntity = (e: RelatedEntity) => ({
  id: e.id,
  name: e.name,
  affinity: r2(e.affinity),
  popularity: r2(e.popularity),
  tags: e.tags.slice(0, 3),
  why: e.explanation?.slice(0, 140),
});

/** Builds the model-facing tools. `track` registers each in-flight call so the orchestrator can wait for them. */
export function createAgentTools(ctx: RunContext, track: <T>(p: Promise<T>) => Promise<T> = (p) => p): AgentToolSpec[] {
  const cityIds = z.array(z.string()).min(1).max(60);
  const specs: AgentToolSpec[] = [
    spec(
      "searchAct",
      "Qloo /search: find candidate entities for the act name. Returns ids with a disambiguation hint.",
      z.object({ query: z.string().min(1), type: ActType.optional() }),
      async ({ query, type }) => {
        const res = await searchAct(ctx, query, type ?? ctx.input.actType);
        return { status: res.status, candidates: res.data.slice(0, 6).map((c) => ({ id: c.id, name: c.name, hint: c.hint, popularity: r2(c.popularity) })) };
      },
    ),
    spec("confirmAct", "Confirm which searchAct candidate is the act. Call once.", z.object({ entityId: z.string().min(1) }), async ({ entityId }) => {
      const r = confirmAct(ctx, entityId);
      return r.error && !r.act ? { error: r.error } : { act: r.act, note: r.error };
    }),
    spec("getTasteTags", "Qloo tag insights: the act's taste profile (tag names).", z.object({ take: z.number().int().min(3).max(20).optional() }), async ({ take }) => {
      const tags = await fetchTasteTags(ctx, take);
      return { tags: tags.map((t) => t.name) };
    }),
    spec(
      "findTags",
      'Qloo /v2/tags: resolve tag names to Qloo tag ids. purpose "seed" stores them for re-seeding thin heatmaps; purpose "venue" stores them as filters for findPlaces.',
      z.object({ queries: z.array(z.string().min(1)).min(1).max(4), purpose: z.enum(["seed", "venue"]) }),
      async ({ queries, purpose }) => {
        const tags = purpose === "seed" ? await ensureSeedTags(ctx, queries) : await findVenueTags(ctx, queries);
        return { purpose, tags: tags.map((t) => ({ id: t.id, name: t.name })) };
      },
    ),
    spec(
      "probeCities",
      'Qloo heatmap insights for each city id from the pool: affinity (0..1, how much local taste aligns with the act) and popularity (0..1, how known the act already is there). seed "act" uses the act entity; seed "tags" uses the seed tags (thin-data fallback).',
      z.object({ cityIds, seed: z.enum(["act", "tags"]).default("act") }),
      async ({ cityIds: ids, seed }) => {
        const r = await probeCities(ctx, ids, seed);
        const thin = pendingThinCities(ctx);
        return {
          ...r,
          probed: ctx.state.heatmaps.size,
          thin,
          hint: thin.length ? 'Thin cities: call findTags (purpose "seed") with 2-3 of the act\'s taste tags, then probeCities with seed "tags" for them.' : undefined,
        };
      },
    ),
    spec("scoreCities", "Score every probed city: underserved score and quadrant (untapped / established / reach).", z.object({}), async () => {
      const rows = score(ctx);
      return {
        candidates: rows.map((c) => ({ id: c.id, affinity: c.affinity, popularity: c.popularity, underserved: c.underserved, quadrant: c.quadrant, rank: c.affinityRank, status: c.status })),
      };
    }),
    spec("getMomentum", "Qloo /v2/trending for the act: rising, flat or falling.", z.object({ weeks: z.number().int().min(4).max(26).optional() }), async ({ weeks }) => fetchMomentum(ctx, weeks)),
    spec(
      "getDemographics",
      "Qloo demographics insights: the act's overall audience age and gender skew (scores vs baseline), plus localized profiles for the given city ids.",
      z.object({ cityIds: z.array(z.string()).max(20).optional() }),
      async ({ cityIds: ids }) => fetchDemographics(ctx, ids ?? []),
    ),
    spec(
      "routeTour",
      "Pick the stops (locked cities forced in, then highest underserved) and order them geographically. alsoLock forces extra city ids in.",
      z.object({ stops: z.number().int().min(3).max(20).optional(), alsoLock: z.array(z.string()).max(5).optional() }),
      async ({ stops, alsoLock }) => {
        const r = route(ctx, stops, alsoLock ?? []);
        return { order: r.order.map((c, i) => ({ cityId: c.id, quadrant: c.quadrant, legDays: r.legDays[i] })), notes: ctx.state.routeNotes };
      },
    ),
    spec(
      "findOpeners",
      "Qloo insights of the act's own type localized to each city, excluding the act: candidate openers / support acts.",
      z.object({ cityIds, take: z.number().int().min(3).max(15).optional() }),
      async ({ cityIds: ids, take }) => {
        const r = await fetchOpeners(ctx, ids, take);
        return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ? { status: v.status, candidates: v.items.slice(0, 6).map(compactEntity) } : { error: "unknown city" }]));
      },
    ),
    spec(
      "compareAudiences",
      "Qloo /v2/analysis/compare between the act and candidate openers: audience overlap 0..1.",
      z.object({ candidateIds: z.array(z.string()).min(1).max(8) }),
      async ({ candidateIds }) => compareOpeners(ctx, candidateIds),
    ),
    spec(
      "findSponsors",
      "Qloo brand insights seeded by the act, optionally weighted to age buckets (e.g. 25_to_29).",
      z.object({ ageBuckets: z.array(z.string()).max(3).optional(), take: z.number().int().min(3).max(15).optional() }),
      async ({ ageBuckets, take }) => {
        const s = await fetchSponsors(ctx, ageBuckets ?? [], take);
        return { status: s.status, ageBuckets: s.ageBuckets, brands: s.items.slice(0, 8).map(compactEntity) };
      },
    ),
    spec(
      "findPlaces",
      'Qloo place insights localized to each city, filtered by the venue tags from findTags (purpose "venue") and a popularity floor.',
      z.object({ cityIds, minPopularity: z.number().min(0).max(1).optional() }),
      async ({ cityIds: ids, minPopularity }) => {
        if (!ctx.state.venueTags.length && !ctx.state.venueTagsTried) return { error: 'call findTags with purpose "venue" first' };
        const r = await fetchPlaces(ctx, ids, minPopularity);
        return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ? { status: v.status, places: v.items.slice(0, 6).map(compactEntity) } : { error: "unknown city" }]));
      },
    ),
    spec(
      "finalizeStop",
      "Record your picks for one routed city: opener, sponsor and place ids from the earlier results.",
      z.object({
        cityId: z.string(),
        openerIds: z.array(z.string()).max(3),
        sponsorIds: z.array(z.string()).max(3),
        placeIds: z.array(z.string()).max(3),
      }),
      async ({ cityId, ...picks }) => finalizeStop(ctx, cityId, picks, "model"),
    ),
  ];
  return specs.map((s) => ({ ...s, run: (input: unknown) => track(s.run(input)) }));
}
