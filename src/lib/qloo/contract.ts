/**
 * The Qloo tool contract. Implemented in src/lib/qloo (live client + mock), consumed by src/lib/agent.
 * Every method returns a ToolResult envelope; nothing throws on thin data. Only network/auth failures become status "error".
 */
import type { ActLink, ActType, CityPoolEntry, Region, ToolResult } from "@/lib/types";

export interface EntityCandidate {
  id: string;
  name: string;
  type: ActType;
  subtype?: string;
  popularity?: number;
  imageUrl?: string;
  /** Qloo's short description, when the entity carries one. */
  description?: string;
  /** Links built from Qloo `external` ids and `properties.website`. */
  links?: ActLink[];
  /** Short disambiguation line, e.g. "Artist · Indie rock · popularity 0.78". */
  hint: string;
}

export interface TagRef { id: string; name: string; type?: string }

export interface HeatmapCell { lat: number; lon: number; affinity: number; affinityRank: number; popularity: number }
export interface CityHeatmap {
  city: CityPoolEntry;
  /** Aggregate for the city: mean of its top cells (by affinity) within CITY_CELL_RADIUS_KM of the centroid. */
  affinity: number;
  affinityRank: number;
  popularity: number;
  /** The region cells assigned to this city. Empty when none fell within reach (a thin city). */
  cells: HeatmapCell[];
}

/**
 * One region-wide heatmap, cut up by city. Qloo rank-normalizes affinity and popularity within each query, so this
 * is the only shape whose city values are comparable with one another (settled on key day, 2026-10-14).
 */
export interface RegionHeatmap {
  region: Region;
  /** WKT polygon sent as filter.location. */
  polygon: string;
  /** Cells Qloo returned for the polygon before assignment to cities. */
  cellCount: number;
  /** One row per requested city, in request order. Cities with no cells in reach have empty cells and zero values. */
  cities: CityHeatmap[];
}

export interface DemographicsData {
  age: { bucket: string; score: number }[];
  gender: { female: number; male: number };
}

export interface TrendingData {
  trend: "rising" | "flat" | "falling" | "unknown";
  velocity?: number;
  weeks?: number;
  series?: { date: string; percentile: number }[];
}

export interface RelatedEntity {
  id: string;
  name: string;
  type?: string;
  popularity?: number;
  affinity?: number;
  tags: string[];
  /** From feature.explainability when present, otherwise undefined. */
  explanation?: string;
}

/** `overlap` is a compatibility name for a derived taste-similarity index, never measured shared fans. */
export interface CompareData { overlap: number; sharedTags: string[] }

export interface QlooClient {
  /** Explicit source identity; injected clients without it remain unknown. */
  readonly mode?: "mock" | "live";
  /** GET /search */
  searchEntity(query: string, type: ActType): Promise<ToolResult<EntityCandidate[]>>;
  /** GET /v2/tags */
  findTags(query: string, opts?: { typeHint?: string }): Promise<ToolResult<TagRef[]>>;
  /**
   * GET /v2/insights?filter.type=urn:heatmap&filter.location=<region WKT polygon>, seeded by the act (or by tags when
   * the act is thin), with the returned cells assigned to the requested cities by proximity. One call per region.
   * Status: ok when every city got cells; partial when some got none (meta.note names them); empty when the region
   * returned no cells, or none within reach of any requested city; degraded when the tag seed had to stand in for
   * the act. The data always carries one row per requested city.
   */
  heatmapForCities(seed: { entityIds?: string[]; tagIds?: string[] }, cities: CityPoolEntry[], region: Region): Promise<ToolResult<RegionHeatmap>>;
  /** GET /v2/insights?filter.type=urn:demographics, optionally localized. */
  demographics(seed: { entityIds?: string[]; tagIds?: string[] }, opts?: { locationQuery?: string }): Promise<ToolResult<DemographicsData>>;
  /** GET /v2/trending */
  trending(entityId: string, type: ActType, opts?: { weeks?: number }): Promise<ToolResult<TrendingData>>;
  /**
   * GET /v2/insights?filter.type=<same type> localized to a city, excluding the act. Openers / support acts.
   * `popularity` is a Qloo popularity band (filter.popularity.min/max, verified live 2026-10-14) so openers sit below
   * the headliner; when nothing matches inside the band the client retries without it and reports "degraded".
   */
  relatedActs(
    entityId: string,
    type: ActType,
    opts: { locationQuery?: string; take?: number; explain?: boolean; popularity?: { min: number; max: number } },
  ): Promise<ToolResult<RelatedEntity[]>>;
  /** GET /v2/analysis/compare between the act and a candidate opener. */
  compareAudiences(aEntityId: string, bEntityId: string, type: ActType): Promise<ToolResult<CompareData>>;
  /** GET /v2/insights?filter.type=urn:entity:brand seeded by the act, optionally biased by demographics. */
  brands(entityId: string, opts?: { ageBuckets?: string[]; take?: number; explain?: boolean }): Promise<ToolResult<RelatedEntity[]>>;
  /** GET /v2/insights?filter.type=urn:entity:place localized to a city with tag filters. */
  places(entityId: string, opts: { locationQuery: string; tagIds?: string[]; minPopularity?: number; take?: number; explain?: boolean }): Promise<ToolResult<RelatedEntity[]>>;
  /** GET /v2/insights?filter.type=urn:tag: the act's taste profile. */
  tasteTags(entityId: string, opts?: { take?: number }): Promise<ToolResult<TagRef[]>>;
}
