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
});
export type PlanInput = z.infer<typeof PlanInput>;

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
  /** 0..1 fanbase overlap from /v2/analysis/compare, openers only. */
  overlap: z.number().min(0).max(1).optional(),
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

export const TraceCall = z.object({
  request: z.string(),
  status: ToolStatus,
  ms: z.number(),
  cached: z.boolean(),
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

export const Plan = z.object({
  id: z.string(),
  createdAt: z.string(),
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
  }),
  /** Optional plain-LLM plan for the "Without Qloo" toggle. */
  withoutQloo: z.object({ cities: z.array(z.string()), openers: z.array(z.string()), note: z.string() }).optional(),
});
export type Plan = z.infer<typeof Plan>;

/** Events streamed from POST /api/plan while the agent runs. */
export type PlanEvent =
  | { type: "step"; step: TraceStep }
  | { type: "act"; act: Act }
  | { type: "candidates"; candidates: CityScore[] }
  | { type: "momentum"; momentum: Momentum }
  | { type: "stop"; stop: Stop }
  | { type: "done"; plan: Plan }
  | { type: "error"; message: string };
