/**
 * Shared contracts for Soundcheck. Every layer (Qloo tools, agent, UI, tour, exports) builds against these.
 * Change here only with care: four workstreams depend on this file.
 */
import { z } from "zod";

/** Mirrors the Qloo harness envelope so thin data degrades instead of throwing. */
export const ToolStatus = z.enum(["ok", "empty", "partial", "degraded", "error"]);
export type ToolStatus = z.infer<typeof ToolStatus>;

export const ToolMeta = z.object({
  /** Redacted request path, e.g. "GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=[act]". Never contains the key or raw IDs. */
  request: z.string(),
  ms: z.number(),
  cached: z.boolean(),
  note: z.string().optional(),
});
export type ToolMeta = z.infer<typeof ToolMeta>;

export interface ToolResult<T> {
  status: ToolStatus;
  data: T;
  meta: ToolMeta;
}

export const ActType = z.enum(["artist", "person", "podcast", "book", "video_game", "brand"]);
export type ActType = z.infer<typeof ActType>;

export const Region = z.enum(["north-america", "uk-ireland", "europe"]);
export type Region = z.infer<typeof Region>;

/** How the tour moves. Picks Soundcheck's travel-cost assumptions; every rate stays editable on the plan. */
export const BudgetTier = z.enum(["van", "bus", "production"]);
export type BudgetTier = z.infer<typeof BudgetTier>;

/** The room size the act plays today, stated by the manager. Qloo popularity cannot tell room sizes apart; see src/lib/room.ts. */
export const RoomTier = z.enum(["under300", "300to800", "800to2000", "2000to5000", "over5000"]);
export type RoomTier = z.infer<typeof RoomTier>;

export const PlanInput = z.object({
  actQuery: z.string().min(1),
  /** Qloo entity id once resolved; the agent resolves it when absent. */
  actId: z.string().optional(),
  actType: ActType.default("artist"),
  region: Region.default("north-america"),
  stops: z.number().int().min(3).max(20).default(10),
  /** Free text like "Jan–Mar 2027". */
  window: z.string().optional(),
  lockedCities: z.array(z.string()).default([]),
  excludedCities: z.array(z.string()).default([]),
  budgetTier: BudgetTier.default("bus"),
  /** Absent means "guess from Qloo popularity", and every room figure is labeled as a guess. */
  roomTier: RoomTier.optional(),
  /**
   * Manual stop order as city ids, set when the user reorders the route by hand. Honoured by the router only when it
   * lists exactly the routed cities; otherwise the router orders the tour itself.
   */
  order: z.array(z.string()).optional(),
});
export type PlanInput = z.infer<typeof PlanInput>;

/**
 * One edit to a finished plan, expressed as a change-set over its PlanInput. Cities are pool ids (see
 * src/lib/revision.ts for resolving names). Every field is optional so a change-set composes: a "Drop" button
 * adds to `drop`, the revise bar's model proposal fills several at once.
 */
export const ChangeSet = z.object({
  /** City ids to add to lockedCities. */
  lock: z.array(z.string()).default([]),
  /** City ids to remove from lockedCities. */
  unlock: z.array(z.string()).default([]),
  /** City ids to add to excludedCities. The router fills the freed slot with the next best city. */
  drop: z.array(z.string()).default([]),
  /** City ids to remove from excludedCities. */
  restore: z.array(z.string()).default([]),
  stops: z.number().int().min(3).max(20).optional(),
  window: z.string().optional(),
  budgetTier: BudgetTier.optional(),
  roomTier: RoomTier.optional(),
  /** Manual order of the routed city ids; see PlanInput.order. */
  order: z.array(z.string()).optional(),
});
export type ChangeSet = z.infer<typeof ChangeSet>;

/** What the model proposes for a free-text revision request, before the user confirms it. */
export const RevisionProposal = z.object({
  changes: ChangeSet,
  /** One line restating the request as the model understood it. */
  note: z.string().max(300),
  /** City names in the request that matched nothing in the pool. */
  unmatched: z.array(z.string()).default([]),
});
export type RevisionProposal = z.infer<typeof RevisionProposal>;

/** A revision run: the parent plan plus the change-set to apply to its input. The server derives the new PlanInput. */
export const RevisionRequest = z.object({ parentId: z.string(), changes: ChangeSet });
export type RevisionRequest = z.infer<typeof RevisionRequest>;

/** Body of POST /api/plan and the sessionStorage hand-off to /run: an original input or a revision request. */
export const RunRequest = z.union([RevisionRequest, PlanInput]);
export type RunRequest = z.infer<typeof RunRequest>;

export function isRevisionRequest(r: RunRequest): r is RevisionRequest {
  return "parentId" in r && typeof r.parentId === "string";
}

/** An outbound link that lets the user confirm the act (Wikipedia, Spotify, official site, ...). */
export const ActLink = z.object({ label: z.string(), url: z.string().url() });
export type ActLink = z.infer<typeof ActLink>;

export const Act = z.object({
  id: z.string(),
  name: z.string(),
  type: ActType,
  subtype: z.string().optional(),
  popularity: z.number().min(0).max(1).optional(),
  imageUrl: z.string().url().optional(),
  /** One line about the act, from Qloo or Wikipedia, fetched at run time. */
  description: z.string().optional(),
  /** Confirmation links, fetched at run time (Qloo external ids first, then Wikipedia / Wikidata). */
  links: z.array(ActLink).default([]),
  /** Qloo tag names describing the act's taste profile, e.g. ["indie rock", "shoegaze"]. */
  tasteTags: z.array(z.string()).default([]),
});
export type Act = z.infer<typeof Act>;

export const Quadrant = z.enum(["untapped", "established", "reach"]);
export type Quadrant = z.infer<typeof Quadrant>;

export const CityPoolEntry = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  /** Metro population in millions, used for venue-size hints. */
  metroM: z.number().optional(),
});
export type CityPoolEntry = z.infer<typeof CityPoolEntry>;

export const CityScore = CityPoolEntry.extend({
  affinity: z.number().min(0).max(1),
  affinityRank: z.number().int().min(1),
  popularity: z.number().min(0).max(1),
  /** Soundcheck's own score: high affinity and low popularity rank highest. */
  underserved: z.number().min(0).max(1),
  quadrant: Quadrant,
  status: ToolStatus,
});
export type CityScore = z.infer<typeof CityScore>;

export const Demographics = z.object({
  /** Qloo age buckets with scores vs baseline, roughly -1..1. */
  age: z.array(z.object({ bucket: z.string(), score: z.number() })),
  /** Qloo gender scores vs baseline, roughly -1..1 (not shares). Positive female = skews female. */
  gender: z.object({ female: z.number(), male: z.number() }),
  status: ToolStatus,
});
export type Demographics = z.infer<typeof Demographics>;

export const Pick = z.object({
  id: z.string(),
  name: z.string(),
  /** Legacy field. Its semantics were not verified; do not present it as audience overlap. */
  overlap: z.number().min(0).max(1).optional(),
  /** Soundcheck's derived similarity of shared taste scores, not a percentage of shared fans. */
  tasteSimilarity: z.number().min(0).max(1).optional(),
  /** Qloo popularity percentile of the pick (0..1). For openers, shown against the headliner's. */
  popularity: z.number().min(0).max(1).optional(),
  /** One line from Qloo explainability, or our summary of it. */
  reason: z.string(),
  tags: z.array(z.string()).default([]),
});
export type Pick = z.infer<typeof Pick>;

export const Stop = z.object({
  order: z.number().int().min(1),
  city: CityScore,
  /** Travel days from the previous stop; 0 for the first. */
  legDays: z.number().int().min(0),
  demographics: Demographics,
  openers: z.array(Pick),
  sponsors: z.array(Pick),
  places: z.array(Pick),
  /** Soundcheck's own suggestion, e.g. "1,200-cap room, early announce". */
  suggestion: z.string(),
  /** The one-sentence explanation that ends every city card. */
  whyHere: z.string(),
});
export type Stop = z.infer<typeof Stop>;

export const Momentum = z.object({
  trend: z.enum(["rising", "flat", "falling", "unknown"]),
  /** population_rank_velocity or similar from /v2/trending. */
  velocity: z.number().optional(),
  weeks: z.number().int().optional(),
  status: ToolStatus,
});
export type Momentum = z.infer<typeof Momentum>;

/** Token usage across every model call in a run. Cached tokens are billed at a fraction of the uncached rate. */
export const ModelUsage = z.object({
  id: z.string(),
  calls: z.number().int(),
  steps: z.number().int(),
  inputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  outputTokens: z.number().int(),
  promptCache: z.boolean(),
});
export type ModelUsage = z.infer<typeof ModelUsage>;

export const TraceCall = z.object({
  request: z.string(),
  status: ToolStatus,
  ms: z.number(),
  cached: z.boolean(),
  /** Source and fallback limitations carried from the tool response. */
  note: z.string().optional(),
});
export const TraceStep = z.object({
  id: z.string(),
  name: z.string(),
  status: ToolStatus,
  summary: z.string(),
  calls: z.array(TraceCall),
  startedAt: z.number(),
  endedAt: z.number().optional(),
});
export type TraceStep = z.infer<typeof TraceStep>;

export const PlanProvenance = z.object({
  dataMode: z.enum(["mock", "live", "unknown"]),
  /**
   * "region-normalized": city values come from one region-wide heatmap query, so they share a scale (live client,
   * verified 2026-10-14). "unverified": synthetic per-city cells (mock) or a plan saved before the switch.
   */
  heatmapComparability: z.enum(["unverified", "region-normalized"]),
  demographicsScope: z.literal("act-wide"),
  similarityMethod: z.literal("derived-taste-similarity"),
  scoringMethod: z.literal("heuristic-v1"),
  /** Absent on legacy plans whose saved explanatory text needs conservative display fallbacks. */
  proseVersion: z.literal(2).optional(),
});
export type PlanProvenance = z.infer<typeof PlanProvenance>;

export const Plan = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** The plan this one was revised from. Absent on an original run. */
  parentId: z.string().optional(),
  /** 1 for an original run, parent.revision + 1 for a revision. */
  revision: z.number().int().min(1).optional(),
  /** One line naming what changed from the parent, e.g. "Dropped Tulsa · Locked Austin". */
  revisionNote: z.string().optional(),
  /** Omitted by old saves; infer synthetic ids only, never assume an unlabelled plan is live. */
  provenance: PlanProvenance.optional(),
  input: PlanInput,
  act: Act,
  momentum: Momentum,
  /** Every candidate city scored; the quadrant chart plots all of these. */
  candidates: z.array(CityScore),
  stops: z.array(Stop),
  trace: z.array(TraceStep),
  summary: z.object({
    qlooCallTypes: z.number().int(),
    qlooCalls: z.number().int(),
    untappedStops: z.number().int(),
    overallStatus: ToolStatus,
    /** Model token usage for the whole run, when a model ran. */
    model: ModelUsage.optional(),
  }),
  /** Optional plain-LLM plan for the "Without Qloo" toggle. */
  withoutQloo: z.object({
    cities: z.array(z.string()), openers: z.array(z.string()), note: z.string(),
    /** Present only after a baseline used the matched brief and passed constraint validation. */
    protocolVersion: z.literal(2).optional(),
  }).optional(),
});
export type Plan = z.infer<typeof Plan>;

/** Events streamed from POST /api/plan while the agent runs. */
export type PlanEvent =
  | { type: "provenance"; provenance: PlanProvenance }
  | { type: "step"; step: TraceStep }
  | { type: "act"; act: Act }
  | { type: "candidates"; candidates: CityScore[] }
  | { type: "momentum"; momentum: Momentum }
  | { type: "stop"; stop: Stop }
  | { type: "done"; plan: Plan }
  | { type: "error"; message: string };
