/**
 * Tolerant zod schemas for the Qloo responses Soundcheck parses, plus mappers into the contract's data interfaces.
 *
 * Every object schema uses .passthrough() so unknown fields survive, and every field is optional with .catch()
 * so one odd field never sinks a whole response. Lists are parsed item by item; unparseable items are dropped.
 * Shapes follow docs.qloo.com (heatmaps-use-case, demographics-use-case, taste-analysis, get-trending, schema-taxonomy).
 */
import { z } from "zod";
import type { ActType, CityPoolEntry, Region } from "@/lib/types";
import { CITY_CELL_RADIUS_KM, distanceKm } from "@/lib/geo";
import { linksFromQlooExternal } from "@/lib/actProfile";
import type {
  CityHeatmap,
  CompareData,
  DemographicsData,
  EntityCandidate,
  HeatmapCell,
  RegionHeatmap,
  RelatedEntity,
  TagRef,
  TrendingData,
} from "./contract";

// ---------- helpers ----------

const opt = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const num = opt(z.number());
const str = opt(z.string());

function parseList<T extends z.ZodType>(schema: T, input: unknown): z.infer<T>[] {
  if (!Array.isArray(input)) return [];
  const out: z.infer<T>[] = [];
  for (const item of input) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

// ---------- shared pieces ----------

/** Tags appear as {id,name,type} on entities and as {tag_id,name,subtype,tag_value} in tag results. */
export const QlooTagSchema = z
  .object({
    id: str,
    tag_id: str,
    tag_value: str,
    name: str,
    type: str,
    subtype: str,
    types: opt(z.array(z.string())),
    query: opt(z.object({ affinity: num }).passthrough()),
  })
  .passthrough();
export type QlooTag = z.infer<typeof QlooTagSchema>;

/** Entity as documented in schema-taxonomy; image/description may be top-level or under `properties`. */
export const QlooEntitySchema = z
  .object({
    entity_id: str,
    id: str,
    name: str,
    type: str,
    subtype: str,
    types: opt(z.array(z.string())),
    popularity: num,
    affinity: num,
    disambiguation: opt(z.string().nullable()),
    url: str,
    short_description: str,
    properties: opt(
      z
        .object({
          image: opt(z.object({ url: str }).passthrough()),
          short_description: str,
          description: str,
          website: str,
        })
        .passthrough(),
    ),
    external: opt(z.record(z.string(), z.unknown())),
    tags: opt(z.array(z.unknown())),
    query: opt(
      z
        .object({
          affinity: num,
          explainability: opt(z.unknown()),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type QlooEntity = z.infer<typeof QlooEntitySchema>;

// ---------- responses ----------

/** GET /v2/insights for entity types (artist, person, podcast, brand, place, ...): results.entities[]. */
export const InsightsEntitiesResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(z.object({ entities: opt(z.array(z.unknown())) }).passthrough()),
    query: opt(z.unknown()),
  })
  .passthrough();

/** GET /v2/insights?filter.type=urn:heatmap: results.heatmap[] of {location{latitude,longitude,geohash}, query{affinity,affinity_rank,popularity}}. */
export const HeatmapPointSchema = z
  .object({
    location: z.object({ latitude: z.number(), longitude: z.number(), geohash: str }).passthrough(),
    query: z.object({ affinity: num, affinity_rank: num, popularity: num }).passthrough(),
  })
  .passthrough();

/**
 * Heatmap body. A `filter.location=<WKT polygon>` query carries no `query.localities` block (key day, 2026-10-14),
 * so only the cells are read.
 */
export const HeatmapResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(z.object({ heatmap: opt(z.array(z.unknown())) }).passthrough()),
    query: opt(z.unknown()),
  })
  .passthrough();

/** GET /v2/insights?filter.type=urn:demographics: results.demographics[] of {entity_id, query{age{bucket:score}, gender{male,female}}}. */
export const DemographicsBlockSchema = z
  .object({
    entity_id: str,
    query: z
      .object({
        age: opt(z.record(z.string(), z.number())),
        gender: opt(z.record(z.string(), z.number())),
      })
      .passthrough(),
  })
  .passthrough();

export const DemographicsResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(z.object({ demographics: opt(z.array(z.unknown())) }).passthrough()),
  })
  .passthrough();

/** GET /v2/tags and GET /v2/insights?filter.type=urn:tag: results.tags[] (taste-analysis). Tolerates results being the array itself. */
export const TagsResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(z.union([z.object({ tags: opt(z.array(z.unknown())) }).passthrough(), z.array(z.unknown())])),
  })
  .passthrough();

/** GET /search: `results` is a top-level array of entities (get-search OpenAPI). */
export const SearchResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(z.union([z.array(z.unknown()), z.object({ entities: opt(z.array(z.unknown())) }).passthrough()])),
  })
  .passthrough();

/** GET /v2/trending: results.trending[] weekly rows, newest first. */
export const TrendingRowSchema = z
  .object({
    date: z.string(),
    population_percentile: num,
    population_rank: num,
    population_rank_velocity: num,
    velocity_fold_change: num,
    population_percent_delta: num,
  })
  .passthrough();

export const TrendingResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(z.object({ trending: opt(z.array(z.unknown())) }).passthrough()),
  })
  .passthrough();

/**
 * GET /v2/analysis/compare (live body captured on key day, 2026-10-14): `results.tags[]` are the tags the two sides
 * share, each with `query.score` (0..1); `results.a[]` / `results.b[]` are each side's own tag lists (`query.count`);
 * `results.matchEntities` was []. There are no per-side affinities.
 */
const CompareTagSchema = z
  .object({
    tag_id: str,
    id: str,
    name: str,
    query: opt(z.object({ score: num }).passthrough()),
  })
  .passthrough();

export const CompareResponse = z
  .object({
    success: opt(z.boolean()),
    results: opt(
      z
        .object({
          tags: opt(z.array(z.unknown())),
          a: opt(z.array(z.unknown())),
          b: opt(z.array(z.unknown())),
        })
        .passthrough(),
    ),
  })
  .passthrough();

// ---------- mappers ----------

export function entityId(e: QlooEntity): string | undefined {
  return e.entity_id ?? e.id;
}

export function tagRef(raw: unknown): TagRef | undefined {
  const r = QlooTagSchema.safeParse(raw);
  if (!r.success) return undefined;
  const t = r.data;
  const id = t.tag_id ?? t.id ?? t.tag_value;
  const name = t.name ?? (id ? humanizeUrn(id) : undefined);
  if (!id || !name) return undefined;
  return { id, name, type: t.subtype ?? t.type };
}

export function humanizeUrn(urn: string): string {
  const last = urn.split(":").pop() ?? urn;
  return last.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function entityTagNames(e: QlooEntity, max = 6): string[] {
  const names: string[] = [];
  for (const raw of e.tags ?? []) {
    const t = tagRef(raw);
    if (t && !names.includes(t.name)) names.push(t.name);
    if (names.length >= max) break;
  }
  return names;
}

const TYPE_LABEL: Record<ActType, string> = {
  artist: "Artist",
  person: "Person",
  podcast: "Podcast",
  book: "Book",
  video_game: "Video game",
  brand: "Brand",
};

export function toEntityCandidate(raw: unknown, type: ActType): EntityCandidate | undefined {
  const r = QlooEntitySchema.safeParse(raw);
  if (!r.success) return undefined;
  const e = r.data;
  const id = entityId(e);
  if (!id || !e.name) return undefined;
  const tags = entityTagNames(e, 2);
  const descriptor = tags[0] ?? (e.disambiguation && e.disambiguation !== e.name ? e.disambiguation : undefined);
  const hint = [TYPE_LABEL[type], descriptor, e.popularity !== undefined ? `popularity ${e.popularity.toFixed(2)}` : undefined]
    .filter(Boolean)
    .join(" · ");
  return {
    id,
    name: e.name,
    type,
    subtype: tags[0] ?? e.subtype,
    popularity: e.popularity !== undefined ? clamp01(e.popularity) : undefined,
    imageUrl: e.properties?.image?.url ?? e.url,
    description: e.properties?.short_description ?? e.short_description ?? e.properties?.description,
    links: linksFromQlooExternal(e.external, e.properties?.website),
    hint,
  };
}

/**
 * Explainability (parameters reference, feature.explainability): each result carries `query.explainability`, showing
 * which input entities contributed, with normalized 0-1 scores. The docs do not print the exact JSON, so we walk the
 * value and collect any {id-ish, score-ish} pairs, or {id: score} maps. Qloo gives numbers, not prose; we write the line.
 */
export function explainabilityContributions(value: unknown, depth = 0): { id: string; score: number }[] {
  if (value === null || value === undefined || depth > 4) return [];
  const out: { id: string; score: number }[] = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...explainabilityContributions(item, depth + 1));
    return out;
  }
  if (typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const id = [obj.entity_id, obj.id, obj.entity, obj.tag_id, obj.tag].find((v): v is string => typeof v === "string");
  const score = [obj.score, obj.impact, obj.weight, obj.value, obj.contribution].find((v): v is number => typeof v === "number");
  if (id && score !== undefined) return [{ id, score }];
  for (const [k, v] of Object.entries(obj)) {
    if (k === "warning") continue;
    if (typeof v === "number" && (k.startsWith("urn:") || /^[0-9a-f-]{20,}$/i.test(k))) out.push({ id: k, score: v });
    else if (typeof v === "object") out.push(...explainabilityContributions(v, depth + 1));
  }
  return out;
}

export function explanationText(
  e: QlooEntity,
  ctx: { actIds: readonly string[]; tagNames?: Record<string, string>; place?: string },
): string | undefined {
  const raw = e.query?.explainability;
  if (raw === undefined) return undefined;
  const contribs = explainabilityContributions(raw).sort((a, b) => b.score - a.score);
  const affinity = e.query?.affinity ?? e.affinity;
  const where = ctx.place ? `; requested location signal: ${ctx.place}` : "";
  const aff = affinity !== undefined ? `, affinity ${affinity.toFixed(2)}` : "";
  if (contribs.length === 0) {
    return affinity !== undefined ? `Recorded affinity ${affinity.toFixed(2)}${where}; local presence and availability are unverified.` : undefined;
  }
  const top = contribs[0];
  const label = ctx.actIds.includes(top.id)
    ? "the act signal"
    : (ctx.tagNames?.[top.id] ?? (top.id.startsWith("urn:") ? humanizeUrn(top.id) : "a related signal"));
  return `Recorded contribution from ${label} (score ${clamp01(top.score).toFixed(2)}${aff})${where}.`;
}

export function toRelatedEntity(
  raw: unknown,
  ctx: { actIds: readonly string[]; place?: string } = { actIds: [] },
): RelatedEntity | undefined {
  const r = QlooEntitySchema.safeParse(raw);
  if (!r.success) return undefined;
  const e = r.data;
  const id = entityId(e);
  if (!id || !e.name) return undefined;
  const affinity = e.query?.affinity ?? e.affinity;
  return {
    id,
    name: e.name,
    type: e.subtype ?? e.type,
    popularity: e.popularity !== undefined ? clamp01(e.popularity) : undefined,
    affinity: affinity !== undefined ? clamp01(affinity) : undefined,
    tags: entityTagNames(e),
    explanation: explanationText(e, ctx),
  };
}

/** Number of top cells (by affinity) averaged into the city aggregate. */
export const HEATMAP_TOP_N = 10;

/**
 * City aggregate from heatmap cells.
 * Choice: mean over the top-N cells by affinity (N = 10, or all cells when fewer). A metro's draw for a touring act
 * depends on its strongest pockets, not on suburbs with no venues, so a plain mean over every cell would penalize
 * sprawling metros. affinityRank and popularity are averaged over the same top-N cells, so popularity reads as
 * "how saturated the act already is where its fans concentrate".
 */
export function aggregateHeatmap(cells: HeatmapCell[], topN = HEATMAP_TOP_N): { affinity: number; affinityRank: number; popularity: number } {
  if (cells.length === 0) return { affinity: 0, affinityRank: 0, popularity: 0 };
  const top = [...cells].sort((a, b) => b.affinity - a.affinity).slice(0, Math.max(1, topN));
  const mean = (f: (c: HeatmapCell) => number) => top.reduce((s, c) => s + f(c), 0) / top.length;
  return {
    affinity: round(clamp01(mean((c) => c.affinity))),
    affinityRank: round(clamp01(mean((c) => c.affinityRank))),
    popularity: round(clamp01(mean((c) => c.popularity))),
  };
}

function toHeatmapCells(list: unknown): HeatmapCell[] {
  return parseList(HeatmapPointSchema, list)
    .filter((p) => p.query.affinity !== undefined)
    .map((p) => ({
      lat: p.location.latitude,
      lon: p.location.longitude,
      affinity: clamp01(p.query.affinity ?? 0),
      affinityRank: clamp01(p.query.affinity_rank ?? 0),
      popularity: clamp01(p.query.popularity ?? 0),
    }));
}

/**
 * One region-wide heatmap (filter.location=<polygon>) cut up by city. Each cell counts toward every requested city
 * whose centroid is within CITY_CELL_RADIUS_KM, so a cell between two close cities counts for both. Each city is
 * aggregated with aggregateHeatmap (top-N mean). Values are comparable across cities because Qloo normalized them
 * over the whole polygon, which also means they shift if the polygon (the city set) changes.
 * Cities with no cell in reach keep an empty `cells` list and zero values. Returns undefined on an unparseable body.
 */
export function toRegionHeatmap(body: unknown, cities: CityPoolEntry[], region: Region, polygon: string): RegionHeatmap | undefined {
  const r = HeatmapResponse.safeParse(body);
  if (!r.success) return undefined;
  const cells = toHeatmapCells(r.data.results?.heatmap);
  return {
    region,
    polygon,
    cellCount: cells.length,
    cities: cities.map((city): CityHeatmap => {
      const near = cells.filter((c) => distanceKm(city, c) <= CITY_CELL_RADIUS_KM);
      return { city, ...aggregateHeatmap(near), cells: near };
    }),
  };
}

export const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;

/**
 * Demographics scores are affinities vs. baseline (positive = over-indexes), per demographics-use-case.
 * Gender is likewise a pair of scores (e.g. male 0.16 / female -0.16), not population shares.
 * When the response holds several blocks (entity + tag signals), prefer the block for `preferId`.
 */
export function toDemographics(body: unknown, preferId?: string): DemographicsData | undefined {
  const r = DemographicsResponse.safeParse(body);
  if (!r.success) return undefined;
  const blocks = parseList(DemographicsBlockSchema, r.data.results?.demographics);
  if (blocks.length === 0) return undefined;
  const block = blocks.find((b) => b.entity_id === preferId) ?? blocks[0];
  const age = block.query.age ?? {};
  const known = AGE_BUCKETS.filter((b) => b in age).map((bucket) => ({ bucket, score: round(age[bucket]) }));
  const extra = Object.keys(age)
    .filter((k) => !(AGE_BUCKETS as readonly string[]).includes(k))
    .map((bucket) => ({ bucket, score: round(age[bucket]) }));
  const gender = block.query.gender ?? {};
  if (known.length + extra.length === 0 && Object.keys(gender).length === 0) return undefined;
  return {
    age: [...known, ...extra],
    gender: { female: round(gender.female ?? 0), male: round(gender.male ?? 0) },
  };
}

export function toTagRefs(body: unknown): TagRef[] {
  const r = TagsResponse.safeParse(body);
  if (!r.success) return [];
  const results = r.data.results;
  const list = Array.isArray(results) ? results : results?.tags;
  if (!Array.isArray(list)) return [];
  const out: TagRef[] = [];
  for (const raw of list) {
    const t = tagRef(raw);
    if (t && !out.some((o) => o.id === t.id)) out.push(t);
  }
  return out;
}

export function toEntityList(body: unknown): unknown[] {
  const r = InsightsEntitiesResponse.safeParse(body);
  if (!r.success) return [];
  return r.data.results?.entities ?? [];
}

export function toSearchList(body: unknown): unknown[] {
  const r = SearchResponse.safeParse(body);
  if (!r.success) return [];
  const results = r.data.results;
  if (Array.isArray(results)) return results;
  return results?.entities ?? [];
}

/**
 * Trend from weekly rows. population_percentile is compared first-to-last week: a move of more than 2 points
 * (on a 0-100 scale; 0.02 if Qloo reports 0-1) is rising/falling, otherwise flat. velocity is the mean
 * population_rank_velocity across the window (falls back to the latest velocity_fold_change).
 */
export function toTrending(body: unknown): TrendingData | undefined {
  const r = TrendingResponse.safeParse(body);
  if (!r.success) return undefined;
  const rows = parseList(TrendingRowSchema, r.data.results?.trending)
    .filter((row) => row.population_percentile !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return undefined;
  const series = rows.map((row) => ({ date: row.date, percentile: row.population_percentile ?? 0 }));
  const velocities = rows.map((row) => row.population_rank_velocity).filter((v): v is number => v !== undefined);
  const velocity = velocities.length
    ? round(velocities.reduce((s, v) => s + v, 0) / velocities.length, 3)
    : rows[rows.length - 1].velocity_fold_change;
  if (rows.length < 2) return { trend: "unknown", velocity, weeks: rows.length, series };
  const scale = series.every((p) => p.percentile <= 1) ? 0.02 : 2;
  const delta = series[series.length - 1].percentile - series[0].percentile;
  const trend = delta > scale ? "rising" : delta < -scale ? "falling" : "flat";
  return { trend, velocity, weeks: rows.length, series };
}

export interface ParsedCompare {
  data: CompareData;
  /** Distinct tags across both sides (shared + side-only). */
  items: number;
  /** True when the body carried the shared and per-side tag lists. */
  scored: boolean;
  counts: { shared: number; onlyA: number; onlyB: number };
}

/**
 * Derived taste-tag similarity from /v2/analysis/compare. This is Soundcheck's index over tag sets, never measured
 * fan overlap. Jaccard over tag ids:
 *   shared = results.tags ids, plus any id listed in both results.a and results.b
 *   onlyA  = results.a ids not in shared;  onlyB = results.b ids not in shared
 *   overlap = shared / (shared + onlyA + onlyB), rounded to 2 decimals (0 when all three are empty)
 * a and b mostly exclude the shared tags but not always (the key-day body repeated 2 shared tags in each), hence the
 * dedupe. sharedTags = the top 5 results.tags names by query.score. `scored` is false when tags/a/b are not all arrays.
 */
export function toCompare(body: unknown): ParsedCompare | undefined {
  const r = CompareResponse.safeParse(body);
  if (!r.success) return undefined;
  const res = r.data.results;
  const none: ParsedCompare = { data: { overlap: 0, sharedTags: [] }, items: 0, scored: false, counts: { shared: 0, onlyA: 0, onlyB: 0 } };
  if (!res || !Array.isArray(res.tags) || !Array.isArray(res.a) || !Array.isArray(res.b)) return none;
  const parse = (list: unknown[]) =>
    parseList(CompareTagSchema, list)
      .map((t) => ({ id: t.tag_id ?? t.id, name: t.name, score: t.query?.score ?? 0 }))
      .filter((t): t is { id: string; name: string | undefined; score: number } => !!t.id);
  const sharedList = parse(res.tags);
  const aIds = new Set(parse(res.a).map((t) => t.id));
  const bIds = new Set(parse(res.b).map((t) => t.id));
  const shared = new Set(sharedList.map((t) => t.id));
  for (const id of aIds) if (bIds.has(id)) shared.add(id);
  const onlyA = [...aIds].filter((id) => !shared.has(id)).length;
  const onlyB = [...bIds].filter((id) => !shared.has(id)).length;
  const items = shared.size + onlyA + onlyB;
  const overlap = items === 0 ? 0 : round(shared.size / items, 2);
  const sharedTags: string[] = [];
  for (const t of [...sharedList].sort((x, y) => y.score - x.score)) {
    const name = t.name ?? humanizeUrn(t.id);
    if (!sharedTags.includes(name)) sharedTags.push(name);
    if (sharedTags.length >= 5) break;
  }
  return { data: { overlap, sharedTags }, items, scored: true, counts: { shared: shared.size, onlyA, onlyB } };
}
