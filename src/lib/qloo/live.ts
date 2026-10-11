/**
 * Live QlooClient against https://hackathon.api.qloo.com.
 *
 * Every method returns a ToolResult envelope and never throws:
 *  - ok        200 with results
 *  - empty     200 with no results, or a 400 the API rejected (e.g. "no locality found"); meta.note says which
 *  - partial   fewer items than requested, or the matched locality looks like the wrong city
 *  - degraded  results came from a fallback (tag seed instead of the act, no location, no tag filter, ...)
 *  - error     network failure, timeout, 401/403/404, or 429/5xx after retries
 *
 * Parameter names are quoted from docs.qloo.com (parameters, available-parameters-by-entity-type, heatmaps-use-case,
 * demographics-use-case, taste-analysis, get-search, search-tags, get-trending, analysis-compare).
 */
import type { ActType, CityPoolEntry, ToolResult, ToolStatus } from "@/lib/types";
import type {
  CityHeatmap,
  CompareData,
  DemographicsData,
  EntityCandidate,
  QlooClient,
  RelatedEntity,
  TagRef,
  TrendingData,
} from "./contract";
import { QlooHttpClient, type QlooHttpOptions, type QlooRequest } from "./client";
import type { RedactContext } from "./redact";
import {
  toCityHeatmap,
  toCompare,
  toDemographics,
  toEntityCandidate,
  toEntityList,
  toRelatedEntity,
  toSearchList,
  toTagRefs,
  toTrending,
} from "./schemas";

// ---------- type URNs ----------

/** `filter.type` for /v2/insights. The hackathon guide lists `urn:entity:video_game` (with underscore). */
export const INSIGHTS_TYPE: Record<ActType, string> = {
  artist: "urn:entity:artist",
  person: "urn:entity:person",
  podcast: "urn:entity:podcast",
  book: "urn:entity:book",
  video_game: "urn:entity:video_game",
  brand: "urn:entity:brand",
};

/**
 * `types` for /search. The guide warns these differ from Insights' filter.type; the get-search enum spells video games
 * `urn:entity:videogame` (no underscore). The same enum is printed for /v2/trending and /v2/analysis/compare.
 */
export const SEARCH_TYPE: Record<ActType, string> = {
  artist: "urn:entity:artist",
  person: "urn:entity:person",
  podcast: "urn:entity:podcast",
  book: "urn:entity:book",
  video_game: "urn:entity:videogame",
  brand: "urn:entity:brand",
};

// ---------- locality queries ----------

const COUNTRY_NAMES: Record<string, string[]> = {
  US: ["United States"],
  CA: ["Canada"],
  GB: ["United Kingdom", "England", "Scotland", "Wales", "Northern Ireland"],
  IE: ["Ireland"],
  PT: ["Portugal"],
  ES: ["Spain"],
  FR: ["France"],
  BE: ["Belgium"],
  NL: ["Netherlands"],
  DE: ["Germany"],
  DK: ["Denmark"],
  SE: ["Sweden"],
  NO: ["Norway"],
  FI: ["Finland"],
  PL: ["Poland"],
  CZ: ["Czech", "Czechia"],
  AT: ["Austria"],
  HU: ["Hungary"],
  CH: ["Switzerland"],
  IT: ["Italy"],
};

/**
 * City names that collide with other localities. The locality docs show comma-qualified queries such as
 * "Garden City, New York", so we qualify these up front. Everything else is sent as the bare city name.
 */
const LOCATION_QUERY_OVERRIDES: Record<string, string> = {
  london: "London, United Kingdom",
  birmingham: "Birmingham, United Kingdom",
  manchester: "Manchester, United Kingdom",
  portland: "Portland, Oregon",
  washington: "Washington, District of Columbia",
  columbus: "Columbus, Ohio",
  "kansas-city": "Kansas City, Missouri",
  halifax: "Halifax, Nova Scotia",
  valencia: "Valencia, Spain",
};

export function locationQueryFor(city: CityPoolEntry): string {
  return LOCATION_QUERY_OVERRIDES[city.id] ?? city.name;
}

function qualifiedQuery(city: CityPoolEntry): string {
  const country = COUNTRY_NAMES[city.country]?.[0] ?? city.country;
  return `${city.name}, ${country}`;
}

function localityMatchesCountry(city: CityPoolEntry, disambiguation?: string): boolean {
  if (!disambiguation) return true; // nothing to check against
  const names = COUNTRY_NAMES[city.country];
  if (!names) return true;
  const d = disambiguation.toLowerCase();
  return names.some((n) => d.includes(n.toLowerCase()));
}

// ---------- request builders (also used by the mock so traces match) ----------

export type Seed = { entityIds?: string[]; tagIds?: string[] };

/** Monday on or before `now` (UTC), so trending URLs (and their cache keys) are stable for a week. */
export function trendingWindow(weeks: number, now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - weeks * 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const clampTake = (n: number | undefined, dflt: number) => Math.min(50, Math.max(1, Math.round(n ?? dflt)));

export const qlooRequests = {
  /** GET /search?query=&types= (get-search). */
  search(query: string, type: ActType, take = 5): QlooRequest {
    return { path: "/search", params: { query, types: SEARCH_TYPE[type], take } };
  },
  /** GET /v2/tags?filter.query=&feature.typo_tolerance=true[&filter.tag.types=] (search-tags). */
  tags(query: string, typeHint?: string, take = 20): QlooRequest {
    return {
      path: "/v2/tags",
      params: {
        "filter.query": query,
        "filter.tag.types": typeHint?.startsWith("urn:tag:") ? typeHint : undefined,
        "feature.typo_tolerance": true,
        take,
      },
    };
  },
  /**
   * GET /v2/insights?filter.type=urn:heatmap&filter.location.query=&signal.interests.entities|tags= (heatmaps-use-case).
   * take=50 (documented max) since the heatmap table lists `take`; whether it caps cells is a key-day check.
   */
  heatmap(seed: Seed, locationQuery: string): QlooRequest {
    return {
      path: "/v2/insights",
      params: {
        "filter.type": "urn:heatmap",
        "filter.location.query": locationQuery,
        "signal.interests.entities": seed.entityIds,
        "signal.interests.tags": seed.tagIds,
        take: 50,
      },
    };
  },
  /** GET /v2/insights?filter.type=urn:demographics&signal.interests.entities|tags= (demographics-use-case; no location param documented). */
  demographics(seed: Seed): QlooRequest {
    return {
      path: "/v2/insights",
      params: {
        "filter.type": "urn:demographics",
        "signal.interests.entities": seed.entityIds,
        "signal.interests.tags": seed.tagIds,
      },
    };
  },
  /** GET /v2/trending?filter.type=&signal.interests.entities=&filter.start_date=&filter.end_date= (get-trending; all four required). */
  trending(entityId: string, type: ActType, weeks: number, now?: Date): QlooRequest {
    const { start, end } = trendingWindow(weeks, now);
    return {
      path: "/v2/trending",
      params: {
        "filter.type": SEARCH_TYPE[type],
        "signal.interests.entities": [entityId],
        "filter.start_date": start,
        "filter.end_date": end,
        take: weeks > 20 ? Math.min(50, weeks) : undefined,
      },
    };
  },
  /**
   * GET /v2/insights same filter.type as the act, signal.location.query for the city, filter.exclude.entities for the act.
   * signal.location.query and feature.explainability are listed as compatible with Artist/Person/Podcast in the
   * parameter reference, though the per-type table omits them (unverified until key day).
   */
  related(entityId: string, type: ActType, opts: { locationQuery?: string; take?: number; explain?: boolean }): QlooRequest {
    return {
      path: "/v2/insights",
      params: {
        "filter.type": INSIGHTS_TYPE[type],
        "signal.interests.entities": [entityId],
        "signal.location.query": opts.locationQuery,
        "filter.exclude.entities": [entityId],
        take: clampTake(opts.take, 10),
        "feature.explainability": opts.explain ? true : undefined,
      },
    };
  },
  /** GET /v2/analysis/compare?a.signal.interests.entities=&b.signal.interests.entities=&filter.type= (analysis-compare). */
  compare(a: string, b: string, type: ActType): QlooRequest {
    return {
      path: "/v2/analysis/compare",
      params: {
        "a.signal.interests.entities": [a],
        "b.signal.interests.entities": [b],
        "filter.type": SEARCH_TYPE[type],
      },
    };
  },
  /** GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=&signal.demographics.age= (Brand table). */
  brands(entityId: string, opts: { ageBuckets?: string[]; take?: number; explain?: boolean }): QlooRequest {
    return {
      path: "/v2/insights",
      params: {
        "filter.type": "urn:entity:brand",
        "signal.interests.entities": [entityId],
        "signal.demographics.age": opts.ageBuckets?.length ? opts.ageBuckets : undefined,
        take: clampTake(opts.take, 10),
        "feature.explainability": opts.explain ? true : undefined,
      },
    };
  },
  /** GET /v2/insights?filter.type=urn:entity:place&filter.location.query=&filter.tags=&filter.popularity.min= (Place table + parameters). */
  places(entityId: string, opts: { locationQuery: string; tagIds?: string[]; minPopularity?: number; take?: number; explain?: boolean }): QlooRequest {
    return {
      path: "/v2/insights",
      params: {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": [entityId],
        "filter.location.query": opts.locationQuery,
        "filter.tags": opts.tagIds?.length ? opts.tagIds : undefined,
        "filter.popularity.min": opts.minPopularity,
        take: clampTake(opts.take, 10),
        "feature.explainability": opts.explain ? true : undefined,
      },
    };
  },
  /** GET /v2/insights?filter.type=urn:tag&signal.interests.entities= (taste-analysis), optionally diversify.by=subtype (Tag table). */
  tasteTags(entityId: string, take: number, diversify: boolean): QlooRequest {
    return {
      path: "/v2/insights",
      params: {
        "filter.type": "urn:tag",
        "signal.interests.entities": [entityId],
        take: clampTake(take, 20),
        "diversify.by": diversify ? "subtype" : undefined,
        "diversify.take": diversify ? Math.max(2, Math.ceil(clampTake(take, 20) / 3)) : undefined,
      },
    };
  },
};

// ---------- envelope machinery ----------

interface Step {
  req: QlooRequest;
  /** Why this step exists when it is a fallback, e.g. "seeded by tags". */
  fallbackNote?: string;
}

interface Parsed<T> {
  data: T;
  count: number;
  /** Requested item count; fewer returned → "partial". */
  requested?: number;
  note?: string;
  /** Force a status for a data-bearing response (e.g. "partial" on a locality mismatch). */
  status?: ToolStatus;
}

export interface LadderOutcome<T> {
  result: ToolResult<T>;
  /** The parse output of the step that produced data, when any did. */
  parsed?: Parsed<T>;
}

export class LiveQlooClient implements QlooClient {
  readonly http: QlooHttpClient;
  private readonly now: () => Date;

  constructor(opts: QlooHttpOptions | { http: QlooHttpClient; now?: () => Date }) {
    if ("http" in opts) {
      this.http = opts.http;
      this.now = opts.now ?? (() => new Date());
    } else {
      this.http = new QlooHttpClient(opts);
      this.now = () => new Date();
    }
  }

  /**
   * Runs steps in order until one returns data. The first step returning data is "ok" (or "partial"); a later one is
   * "degraded". A fatal HTTP failure stops the ladder with "error". All-empty ends as "empty".
   */
  private async ladder<T>(
    steps: Step[],
    parse: (body: unknown) => Parsed<T> | undefined,
    emptyData: T,
    ctx: RedactContext,
  ): Promise<LadderOutcome<T>> {
    const started = Date.now();
    const notes: string[] = [];
    let allCached = true;
    let lastRequest = "";

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const res = await this.http.get(step.req, ctx);
      lastRequest = res.request;
      allCached &&= res.cached;
      if (!res.ok && res.kind === "fatal") {
        notes.push(res.message);
        return { result: envelope("error", emptyData, res.request, started, false, notes) };
      }
      if (!res.ok) {
        notes.push(`${res.request} rejected: ${res.message}`);
        continue;
      }
      const parsed = parse(res.body);
      if (parsed === undefined) {
        notes.push(`${res.request}: unexpected response shape`);
        return { result: envelope("error", emptyData, res.request, started, allCached, notes) };
      }
      if (parsed.count === 0) {
        notes.push(`${res.request} returned no results`);
        continue;
      }
      let status: ToolStatus = i === 0 ? "ok" : "degraded";
      if (status === "ok" && parsed.requested !== undefined && parsed.count < parsed.requested) {
        status = "partial";
        notes.push(`${parsed.count} of ${parsed.requested} requested`);
      }
      if (parsed.status && status === "ok") status = parsed.status;
      if (i > 0 && step.fallbackNote) notes.push(`fallback: ${step.fallbackNote}`);
      if (parsed.note) notes.push(parsed.note);
      return { result: envelope(status, parsed.data, res.request, started, allCached, notes), parsed };
    }
    return { result: envelope("empty", emptyData, lastRequest, started, allCached, notes) };
  }

  // ---------- contract ----------

  async searchEntity(query: string, type: ActType): Promise<ToolResult<EntityCandidate[]>> {
    const { result } = await this.ladder<EntityCandidate[]>(
      [{ req: qlooRequests.search(query, type) }],
      (body) => {
        const data = toSearchList(body)
          .map((raw) => toEntityCandidate(raw, type))
          .filter((c): c is EntityCandidate => !!c);
        return { data, count: data.length };
      },
      [],
      {},
    );
    return result;
  }

  async findTags(query: string, opts: { typeHint?: string } = {}): Promise<ToolResult<TagRef[]>> {
    const steps: Step[] = [{ req: qlooRequests.tags(query, opts.typeHint) }];
    if (opts.typeHint?.startsWith("urn:tag:")) steps.push({ req: qlooRequests.tags(query), fallbackNote: "dropped filter.tag.types" });
    const { result } = await this.ladder<TagRef[]>(
      steps,
      (body) => {
        const data = toTagRefs(body);
        return { data, count: data.length };
      },
      [],
      {},
    );
    return result;
  }

  async heatmapForCity(seed: Seed, city: CityPoolEntry): Promise<ToolResult<CityHeatmap>> {
    const emptyData: CityHeatmap = { city, affinity: 0, affinityRank: 0, popularity: 0, cells: [] };
    const actIds = seed.entityIds ?? [];
    const run = (locationQuery: string) => {
      const steps: Step[] = [];
      if (seed.entityIds?.length) steps.push({ req: qlooRequests.heatmap({ entityIds: seed.entityIds }, locationQuery) });
      if (seed.tagIds?.length)
        steps.push({ req: qlooRequests.heatmap({ tagIds: seed.tagIds }, locationQuery), fallbackNote: "seeded by genre/taste tags, not the act" });
      return this.ladder<CityHeatmap>(
        steps,
        (body) => {
          const parsed = toCityHeatmap(body, city);
          if (!parsed) return undefined;
          const matches = localityMatchesCountry(city, parsed.locality?.disambiguation);
          const notes: string[] = [];
          if (parsed.locality?.disambiguation) notes.push(`locality: ${parsed.locality.disambiguation}`);
          if (parsed.normalizedWithinCity) notes.push("cell affinity looks normalized within the city; compare cities with care");
          return {
            data: parsed.heatmap,
            count: parsed.heatmap.cells.length,
            note: notes.join("; ") || undefined,
            status: matches ? undefined : "partial",
          };
        },
        emptyData,
        { actIds },
      );
    };

    if (!seed.entityIds?.length && !seed.tagIds?.length) {
      return envelope("empty", emptyData, "", Date.now(), true, ["no seed entity or tag supplied"]);
    }
    const query = locationQueryFor(city);
    const first = await run(query);
    // Wrong-city guard: if Qloo matched a locality in another country, retry once with "City, Country".
    if (first.result.status === "partial" && first.parsed?.status === "partial" && !query.includes(",")) {
      const second = await run(qualifiedQuery(city));
      if (second.result.status === "ok" || second.result.status === "degraded") {
        second.result.meta.note = joinNotes([`retried as "${qualifiedQuery(city)}" after a locality mismatch`, second.result.meta.note]);
        second.result.meta.ms += first.result.meta.ms;
        return second.result;
      }
    }
    // "If no localities are found, the API returns a 400 error" (parameters reference): retry qualified once.
    if (first.result.status === "empty" && /rejected: HTTP 400[^;]*locali/i.test(first.result.meta.note ?? "") && !query.includes(",")) {
      const second = await run(qualifiedQuery(city));
      if (second.result.status !== "error" && second.result.status !== "empty") {
        second.result.meta.ms += first.result.meta.ms;
        return second.result;
      }
    }
    return first.result;
  }

  async demographics(seed: Seed, opts: { locationQuery?: string } = {}): Promise<ToolResult<DemographicsData>> {
    const emptyData: DemographicsData = { age: [], gender: { female: 0, male: 0 } };
    const steps: Step[] = [];
    if (seed.entityIds?.length) steps.push({ req: qlooRequests.demographics({ entityIds: seed.entityIds }) });
    if (seed.tagIds?.length)
      steps.push({ req: qlooRequests.demographics({ tagIds: seed.tagIds }), fallbackNote: "seeded by genre/taste tags, not the act" });
    if (steps.length === 0) return envelope("empty", emptyData, "", Date.now(), true, ["no seed entity or tag supplied"]);
    const preferId = seed.entityIds?.[0] ?? seed.tagIds?.[0];
    const { result } = await this.ladder<DemographicsData>(
      steps,
      (body) => {
        const data = toDemographics(body, preferId);
        return data ? { data, count: data.age.length + 1 } : { data: emptyData, count: 0 };
      },
      emptyData,
      { actIds: seed.entityIds ?? [] },
    );
    if (opts.locationQuery && (result.status === "ok" || result.status === "partial")) {
      // The demographics use-case documents no location parameter, so we do not send one (it would be silently
      // ignored). The profile is the act's overall audience; flag that rather than imply it is city-specific.
      result.status = "degraded";
      result.meta.note = joinNotes([
        `not localized: urn:demographics documents no location parameter, so this is the act's overall audience, not ${opts.locationQuery}'s`,
        result.meta.note,
      ]);
    }
    return result;
  }

  async trending(entityId: string, type: ActType, opts: { weeks?: number } = {}): Promise<ToolResult<TrendingData>> {
    const weeks = Math.min(52, Math.max(2, Math.round(opts.weeks ?? 8)));
    const { result } = await this.ladder<TrendingData>(
      [{ req: qlooRequests.trending(entityId, type, weeks, this.now()) }],
      (body) => {
        const data = toTrending(body);
        if (!data) return { data: { trend: "unknown" }, count: 0 };
        const count = data.series?.length ?? 0;
        return { data, count, status: count < Math.ceil(weeks / 2) ? "partial" : undefined, note: count < Math.ceil(weeks / 2) ? `${count} of ${weeks} weeks returned` : undefined };
      },
      { trend: "unknown" },
      { actIds: [entityId] },
    );
    return result;
  }

  async relatedActs(
    entityId: string,
    type: ActType,
    opts: { locationQuery?: string; take?: number; explain?: boolean },
  ): Promise<ToolResult<RelatedEntity[]>> {
    const take = clampTake(opts.take, 10);
    const steps: Step[] = [{ req: qlooRequests.related(entityId, type, { ...opts, take }) }];
    if (opts.locationQuery)
      steps.push({ req: qlooRequests.related(entityId, type, { ...opts, take, locationQuery: undefined }), fallbackNote: "not localized to the city" });
    const { result } = await this.ladder<RelatedEntity[]>(
      steps,
      (body) => {
        const data = toEntityList(body)
          .map((raw) => toRelatedEntity(raw, { actIds: [entityId], place: opts.locationQuery }))
          .filter((e): e is RelatedEntity => !!e && e.id !== entityId);
        return { data, count: data.length, requested: take };
      },
      [],
      { actIds: [entityId] },
    );
    return result;
  }

  async compareAudiences(aEntityId: string, bEntityId: string, type: ActType): Promise<ToolResult<CompareData>> {
    const emptyData: CompareData = { overlap: 0, sharedTags: [] };
    const { result } = await this.ladder<CompareData>(
      [{ req: qlooRequests.compare(aEntityId, bEntityId, type) }],
      (body) => {
        const parsed = toCompare(body);
        if (!parsed) return undefined;
        if (!parsed.scored && parsed.items > 0) {
          return { data: parsed.data, count: parsed.items, status: "degraded", note: "compare returned items without per-side scores; overlap not computed" };
        }
        return { data: parsed.data, count: parsed.scored ? Math.max(1, parsed.items) : 0 };
      },
      emptyData,
      { actIds: [aEntityId] },
    );
    return result;
  }

  async brands(entityId: string, opts: { ageBuckets?: string[]; take?: number; explain?: boolean } = {}): Promise<ToolResult<RelatedEntity[]>> {
    const take = clampTake(opts.take, 10);
    const steps: Step[] = [{ req: qlooRequests.brands(entityId, { ...opts, take }) }];
    if (opts.ageBuckets?.length)
      steps.push({ req: qlooRequests.brands(entityId, { ...opts, take, ageBuckets: undefined }), fallbackNote: "dropped the age-bucket signal" });
    const { result } = await this.ladder<RelatedEntity[]>(
      steps,
      (body) => {
        const data = toEntityList(body)
          .map((raw) => toRelatedEntity(raw, { actIds: [entityId] }))
          .filter((e): e is RelatedEntity => !!e);
        return { data, count: data.length, requested: take };
      },
      [],
      { actIds: [entityId] },
    );
    return result;
  }

  async places(
    entityId: string,
    opts: { locationQuery: string; tagIds?: string[]; minPopularity?: number; take?: number; explain?: boolean },
  ): Promise<ToolResult<RelatedEntity[]>> {
    const take = clampTake(opts.take, 10);
    const steps: Step[] = [{ req: qlooRequests.places(entityId, { ...opts, take }) }];
    if (opts.tagIds?.length)
      steps.push({ req: qlooRequests.places(entityId, { ...opts, take, tagIds: undefined }), fallbackNote: "dropped the venue tag filter" });
    if (opts.minPopularity !== undefined)
      steps.push({
        req: qlooRequests.places(entityId, { ...opts, take, tagIds: undefined, minPopularity: undefined }),
        fallbackNote: "dropped the tag filter and popularity floor",
      });
    const { result } = await this.ladder<RelatedEntity[]>(
      steps,
      (body) => {
        const data = toEntityList(body)
          .map((raw) => toRelatedEntity(raw, { actIds: [entityId], place: opts.locationQuery }))
          .filter((e): e is RelatedEntity => !!e);
        return { data, count: data.length, requested: take };
      },
      [],
      { actIds: [entityId] },
    );
    return result;
  }

  async tasteTags(entityId: string, opts: { take?: number } = {}): Promise<ToolResult<TagRef[]>> {
    const take = clampTake(opts.take, 20);
    const { result } = await this.ladder<TagRef[]>(
      [
        { req: qlooRequests.tasteTags(entityId, take, true) },
        { req: qlooRequests.tasteTags(entityId, take, false), fallbackNote: "without diversify.by=subtype" },
      ],
      (body) => {
        const data = toTagRefs(body);
        return { data, count: data.length };
      },
      [],
      { actIds: [entityId] },
    );
    return result;
  }
}

function joinNotes(notes: (string | undefined)[]): string | undefined {
  const s = notes.filter(Boolean).join("; ");
  return s || undefined;
}

function envelope<T>(status: ToolStatus, data: T, request: string, started: number, cached: boolean, notes: string[]): ToolResult<T> {
  return {
    status,
    data,
    meta: { request, ms: Math.max(0, Date.now() - started), cached, note: joinNotes(notes) },
  };
}
