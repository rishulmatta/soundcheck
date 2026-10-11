/**
 * Deterministic mock QlooClient for QLOO_MOCK=1, keyless local runs, and tests.
 *
 * Every value is synthetic (invented names, invented tag URNs under urn:tag:mock:*) and seeded by a hash of the
 * inputs, so the same query returns the same data on every run. No Qloo response data is stored here.
 * Trace strings come from the same request builders as the live client, so a mock trace reads like a live one.
 *
 * Behaviors worth knowing:
 *  - Names containing "unknown" return "empty" everywhere; names containing "obscure" resolve, but entity-seeded
 *    heatmaps/demographics come back empty (so the agent falls back to tags → "degraded") and lists come back "partial".
 *  - Comedians (person) and podcasts get thinner data than artists: fewer cells, some cities empty, shorter lists.
 *  - City affinity and popularity are spread so a 16-40 city pool lands dots in every quadrant.
 */
import type { ActType, CityPoolEntry, ToolResult, ToolStatus } from "@/lib/types";
import type {
  CityHeatmap,
  CompareData,
  DemographicsData,
  EntityCandidate,
  HeatmapCell,
  QlooClient,
  RelatedEntity,
  TagRef,
  TrendingData,
} from "./contract";
import type { QlooRequest } from "./client";
import { locationQueryFor, qlooRequests, trendingWindow, type Seed } from "./live";
import { redactParts, type RedactContext } from "./redact";
import { aggregateHeatmap, AGE_BUCKETS, toTrending } from "./schemas";

// ---------- deterministic randomness ----------

/** FNV-1a 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG seeded from a string. */
export function seededRandom(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";
const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isUnknown = (s: string) => /unknown/i.test(s);
const isObscure = (s: string) => /obscure|unknown/i.test(s);

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

function pickDistinct<T>(rand: () => number, list: readonly T[], n: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

// ---------- synthetic vocab ----------

const ARTIST_A = ["Harbor", "Dry", "Velvet", "Paper", "Neon", "Glass", "Hollow", "Copper", "Saltwater", "Pale", "Golden", "Quiet", "Wild", "Lantern", "Tin"];
const ARTIST_B = ["Lights", "Pines", "Signals", "Tides", "Hours", "Rivers", "Arcade", "Choir", "Satellites", "Ghosts", "Parade", "Engines", "Orchards", "Moths", "Kites"];
const FIRST = ["Dana", "Marcus", "Priya", "Theo", "Jules", "Rosa", "Eli", "Nadia", "Owen", "Tess", "Ravi", "Maren", "Cole", "Ines", "Wes"];
const LAST = ["Whitlock", "Ferro", "Okonkwo", "Lindqvist", "Banerjee", "Castellano", "Moss", "Adeyemi", "Kowalski", "Reyes", "Halloran", "Vance", "Szabo", "Pruitt", "Navarro"];
const POD_A = ["The Long Table", "Off Mic", "Small Hours", "Second Draft", "Loose Threads", "The Side Door", "Deep Cut", "Field Notes", "Late Checkout", "Common Ground", "Slow Burn", "Green Room"];
const POD_B = ["Podcast", "Radio", "Hour", "Show", "Sessions", "Club"];
const BOOK_A = ["The Salt", "A House of", "Small", "The Last", "Northern", "Paper"];
const BOOK_B = ["Orchard", "Lanterns", "Weather", "Harbor", "Letters", "Hours"];
const GAME_A = ["Star", "Hollow", "Iron", "Pixel", "Drift", "Echo"];
const GAME_B = ["Forge", "Runner", "Tactics", "Frontier", "League", "Odyssey"];
const BRANDS = [
  "Rove Outdoors", "Northline Coffee", "Halftone Audio", "Kettle & Pine", "Lumen Cycles", "Fieldhouse Denim",
  "Brightwater Seltzer", "Atlas Supply Co.", "Parcel Goods", "Summit Oat", "Cinder Skate", "Marlow Optics",
  "Juniper Hard Cider", "Tidewater Apparel", "Ember Hot Sauce", "Postcard Cameras",
];
const VENUE_NOUNS = ["Union Hall", "Record Exchange", "Social Club", "Taproom", "Listening Bar", "Supper Club", "Warehouse", "Rooftop", "Night Market", "Book Loft", "Velvet Room", "Ballroom"];
const PLACE_TAGS = ["live music", "late night", "cocktail bar", "record store", "rooftop", "bookstore", "brewery", "event space"];

const TASTE: Record<ActType, string[]> = {
  artist: ["Indie Rock", "Dream Pop", "Shoegaze", "Post-Punk", "Alt Country", "Synthwave", "Singer-Songwriter", "Vinyl Collecting", "Craft Beer", "Thrift Fashion", "Film Photography", "Cycling"],
  person: ["Stand-Up", "Observational Comedy", "Late-Night TV", "Improv", "Sketch Comedy", "Comedy Podcasts", "Craft Beer", "Road Trips"],
  podcast: ["Comedy", "Interviews", "Culture", "True Crime", "Tech", "Documentary", "Long Reads", "Coffee"],
  book: ["Literary Fiction", "Memoir", "Book Clubs", "Independent Bookstores", "Poetry", "Tea"],
  video_game: ["Strategy", "Indie Games", "Esports", "Speedrunning", "Synthwave", "Energy Drinks"],
  brand: ["Streetwear", "Outdoor Gear", "Sustainability", "Coffee", "Design", "Cycling"],
};
const TAG_TYPE: Record<ActType, string> = {
  artist: "urn:tag:genre:music",
  person: "urn:tag:genre:person",
  podcast: "urn:tag:genre:media",
  book: "urn:tag:genre:media",
  video_game: "urn:tag:genre:media",
  brand: "urn:tag:category:brand",
};
const mockTag = (name: string, type = "urn:tag:mock"): TagRef => ({ id: `urn:tag:mock:${slug(name).replace(/-/g, "_")}`, name, type });

function actName(rand: () => number, type: ActType): string {
  switch (type) {
    case "person":
      return `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
    case "podcast":
      return `${pick(rand, POD_A)} ${pick(rand, POD_B)}`;
    case "book":
      return `${pick(rand, BOOK_A)} ${pick(rand, BOOK_B)}`;
    case "video_game":
      return `${pick(rand, GAME_A)} ${pick(rand, GAME_B)}`;
    case "brand":
      return pick(rand, BRANDS);
    default:
      return `${pick(rand, ARTIST_A)} ${pick(rand, ARTIST_B)}`;
  }
}

const THIN_TYPES: ReadonlySet<ActType> = new Set(["person", "podcast"]);
const ID_PATTERN = /^mock-(artist|person|podcast|book|video_game|brand)-/;

export function mockEntityId(type: ActType, name: string): string {
  return `mock-${type}-${slug(name)}`;
}

function typeFromId(id: string | undefined): ActType {
  const m = id?.match(ID_PATTERN);
  return (m?.[1] as ActType | undefined) ?? "artist";
}

const TYPE_LABEL: Record<ActType, string> = { artist: "Artist", person: "Person", podcast: "Podcast", book: "Book", video_game: "Video game", brand: "Brand" };

// ---------- the mock client ----------

export class MockQlooClient implements QlooClient {
  constructor(private readonly opts: { latencyMs?: number; now?: () => Date } = {}) {}

  private async envelope<T>(status: ToolStatus, data: T, req: QlooRequest, ctx: RedactContext, note?: string): Promise<ToolResult<T>> {
    const request = redactParts(req.path, req.params, ctx);
    const ms = 120 + (hashString(request) % 240);
    const latency = this.opts.latencyMs ?? Number(process.env.QLOO_MOCK_LATENCY_MS ?? 0);
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    return { status, data, meta: { request, ms, cached: false, note: note ? `mock: ${note}` : "mock" } };
  }

  async searchEntity(query: string, type: ActType): Promise<ToolResult<EntityCandidate[]>> {
    const req = qlooRequests.search(query, type);
    if (isUnknown(query)) return this.envelope("empty", [], req, {}, "no entity matched");
    const rand = seededRandom(`search|${type}|${query.toLowerCase()}`);
    const name = titleCase(query);
    const tags = TASTE[type];
    const make = (n: string, popularity: number, tag: string): EntityCandidate => ({
      id: mockEntityId(type, n),
      name: n,
      type,
      subtype: tag,
      popularity: r2(popularity),
      hint: `${TYPE_LABEL[type]} · ${tag} · popularity ${popularity.toFixed(2)}`,
    });
    const primary = make(name, isObscure(query) ? 0.06 + rand() * 0.08 : 0.55 + rand() * 0.4, pick(rand, tags));
    if (isObscure(query)) return this.envelope("ok", [primary], req, {});
    const alternates = [
      make(`${name} Tribute Collective`, 0.05 + rand() * 0.15, pick(rand, tags)),
      make(`The ${name.replace(/^The\s+/i, "")} Revue`, 0.1 + rand() * 0.2, pick(rand, tags)),
    ];
    return this.envelope("ok", [primary, ...alternates], req, {});
  }

  async findTags(query: string, opts: { typeHint?: string } = {}): Promise<ToolResult<TagRef[]>> {
    const req = qlooRequests.tags(query, opts.typeHint);
    if (isUnknown(query) || !query.trim()) return this.envelope("empty", [], req, {}, "no tags matched");
    const rand = seededRandom(`tags|${query.toLowerCase()}|${opts.typeHint ?? ""}`);
    const base = titleCase(query);
    const variants = [base, `${base} Venue`, `Late-Night ${base}`, `${base} Night`, `Underground ${base}`];
    const n = 3 + Math.floor(rand() * 3);
    const type = opts.typeHint?.startsWith("urn:tag:") ? opts.typeHint : "urn:tag:keyword:mock";
    return this.envelope("ok", variants.slice(0, n).map((v) => mockTag(v, type)), req, {});
  }

  async heatmapForCity(seed: Seed, city: CityPoolEntry): Promise<ToolResult<CityHeatmap>> {
    const emptyData: CityHeatmap = { city, affinity: 0, affinityRank: 0, popularity: 0, cells: [] };
    const entityKey = (seed.entityIds ?? []).join(",");
    const tagKey = (seed.tagIds ?? []).join(",");
    const actIds = seed.entityIds ?? [];
    const locationQuery = locationQueryFor(city);
    const entityReq = qlooRequests.heatmap({ entityIds: seed.entityIds }, locationQuery);
    const tagReq = qlooRequests.heatmap({ tagIds: seed.tagIds }, locationQuery);

    if (!entityKey && !tagKey) return this.envelope("empty", emptyData, entityReq, { actIds }, "no seed entity or tag supplied");
    if (isUnknown(entityKey) && !tagKey) return this.envelope("empty", emptyData, entityReq, { actIds }, "no heatmap cells");

    const type = typeFromId(seed.entityIds?.[0]);
    const entityThin = !entityKey || isObscure(entityKey);
    if (entityThin && !tagKey) return this.envelope("empty", emptyData, entityReq, { actIds }, "no heatmap cells for this act");

    const useTags = entityThin;
    const seedKey = useTags ? `tags:${tagKey}` : entityKey;
    const rand = seededRandom(`heatmap|${seedKey}|${city.id}`);
    if (THIN_TYPES.has(type) && rand() < 0.15) {
      return this.envelope("empty", emptyData, useTags ? tagReq : entityReq, { actIds }, "no heatmap cells in this city");
    }

    const cells = synthCells(rand, city, type, useTags);
    const agg = aggregateHeatmap(cells);
    const data: CityHeatmap = { city, ...agg, cells };
    if (useTags) {
      return this.envelope("degraded", data, tagReq, { actIds }, "fallback: seeded by genre/taste tags, not the act");
    }
    return this.envelope("ok", data, entityReq, { actIds });
  }

  async demographics(seed: Seed, opts: { locationQuery?: string } = {}): Promise<ToolResult<DemographicsData>> {
    const emptyData: DemographicsData = { age: [], gender: { female: 0, male: 0 } };
    const entityKey = (seed.entityIds ?? []).join(",");
    const tagKey = (seed.tagIds ?? []).join(",");
    const actIds = seed.entityIds ?? [];
    const entityReq = qlooRequests.demographics({ entityIds: seed.entityIds });
    const tagReq = qlooRequests.demographics({ tagIds: seed.tagIds });
    const entityThin = !entityKey || isObscure(entityKey);
    if (entityThin && !tagKey) return this.envelope("empty", emptyData, entityReq, { actIds }, "no demographics for this act");

    const useTags = entityThin;
    const rand = seededRandom(`demo|${useTags ? tagKey : entityKey}`);
    const peak = 1 + Math.floor(rand() * 3.5);
    const age = AGE_BUCKETS.map((bucket, i) => ({
      bucket,
      score: r2(Math.max(-0.7, Math.min(0.95, 0.85 * Math.exp(-((i - peak) ** 2) / 2.2) - 0.35 + (rand() - 0.5) * 0.15))),
    }));
    const g = r2((rand() - 0.5) * 0.5);
    const data: DemographicsData = { age, gender: { male: g, female: -g } };
    const notes: string[] = [];
    let status: ToolStatus = useTags ? "degraded" : "ok";
    if (useTags) notes.push("fallback: seeded by genre/taste tags, not the act");
    if (opts.locationQuery) {
      status = "degraded";
      notes.push(`not localized: urn:demographics documents no location parameter, so this is the act's overall audience, not ${opts.locationQuery}'s`);
    }
    return this.envelope(status, data, useTags ? tagReq : entityReq, { actIds }, notes.join("; ") || undefined);
  }

  async trending(entityId: string, type: ActType, opts: { weeks?: number } = {}): Promise<ToolResult<TrendingData>> {
    const weeks = Math.min(52, Math.max(2, Math.round(opts.weeks ?? 8)));
    const now = this.opts.now?.() ?? new Date("2026-10-12T00:00:00Z");
    const req = qlooRequests.trending(entityId, type, weeks, now);
    if (isObscure(entityId)) return this.envelope("empty", { trend: "unknown" }, req, { actIds: [entityId] }, "no trending rows");
    const rand = seededRandom(`trend|${entityId}`);
    const { end } = trendingWindow(weeks, now);
    const slope = (rand() - 0.4) * (THIN_TYPES.has(type) ? 1.2 : 2);
    let pct = 35 + rand() * 50;
    const rows = Array.from({ length: weeks }, (_, i) => {
      const d = new Date(`${end}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (weeks - 1 - i) * 7);
      pct = Math.min(99.9, Math.max(1, pct + slope + (rand() - 0.5) * 1.2));
      return {
        date: d.toISOString().slice(0, 10),
        population_percentile: r2(pct),
        population_rank_velocity: Math.round(slope * 3 + (rand() - 0.5) * 2),
        velocity_fold_change: r2(1 + slope / 20),
      };
    });
    const data = toTrending({ results: { trending: rows } }) ?? { trend: "unknown" as const };
    return this.envelope("ok", data, req, { actIds: [entityId] });
  }

  async relatedActs(
    entityId: string,
    type: ActType,
    opts: { locationQuery?: string; take?: number; explain?: boolean },
  ): Promise<ToolResult<RelatedEntity[]>> {
    const take = Math.min(50, Math.max(1, opts.take ?? 10));
    const req = qlooRequests.related(entityId, type, { ...opts, take });
    const ctx = { actIds: [entityId] };
    if (isUnknown(entityId)) return this.envelope("empty", [], req, ctx, "no related acts");
    const rand = seededRandom(`related|${entityId}|${opts.locationQuery ?? ""}`);
    const n = isObscure(entityId) ? 1 : THIN_TYPES.has(type) ? Math.max(1, take - 2) : take;
    const names = uniqueNames(rand, n, () => actName(rand, type));
    const data = names.map((name, i) => {
      const affinity = r2(0.95 - i * (0.25 / Math.max(1, n)) - rand() * 0.03);
      return {
        id: mockEntityId(type, name),
        name,
        type: `urn:entity:${type}`,
        popularity: r2(0.2 + rand() * 0.6),
        affinity,
        tags: pickDistinct(rand, TASTE[type], 2),
        explanation: opts.explain ? explain(rand, affinity, opts.locationQuery) : undefined,
      } satisfies RelatedEntity;
    });
    const status: ToolStatus = n < take ? "partial" : "ok";
    return this.envelope(status, data, req, ctx, status === "partial" ? `${n} of ${take} requested` : undefined);
  }

  async compareAudiences(aEntityId: string, bEntityId: string, type: ActType): Promise<ToolResult<CompareData>> {
    const req = qlooRequests.compare(aEntityId, bEntityId, type);
    const ctx = { actIds: [aEntityId] };
    if (isUnknown(aEntityId) || isUnknown(bEntityId)) return this.envelope("empty", { overlap: 0, sharedTags: [] }, req, ctx, "no comparison");
    const rand = seededRandom(`compare|${aEntityId}|${bEntityId}`);
    const thin = isObscure(aEntityId) || isObscure(bEntityId);
    const overlap = r2(thin ? 0.15 + rand() * 0.2 : 0.35 + rand() * 0.5);
    const sharedTags = pickDistinct(rand, TASTE[type], thin ? 1 : 3);
    return this.envelope("ok", { overlap, sharedTags }, req, ctx);
  }

  async brands(entityId: string, opts: { ageBuckets?: string[]; take?: number; explain?: boolean } = {}): Promise<ToolResult<RelatedEntity[]>> {
    const take = Math.min(50, Math.max(1, opts.take ?? 10));
    const req = qlooRequests.brands(entityId, { ...opts, take });
    const ctx = { actIds: [entityId] };
    if (isUnknown(entityId)) return this.envelope("empty", [], req, ctx, "no brands");
    const rand = seededRandom(`brands|${entityId}|${(opts.ageBuckets ?? []).join(",")}`);
    const type = typeFromId(entityId);
    const n = Math.min(BRANDS.length, isObscure(entityId) ? 2 : THIN_TYPES.has(type) ? Math.max(1, take - 3) : take);
    const data = pickDistinct(rand, BRANDS, n).map((name, i) => {
      const affinity = r2(0.93 - i * 0.03 - rand() * 0.02);
      return {
        id: `mock-brand-${slug(name)}`,
        name,
        type: "urn:entity:brand",
        popularity: r2(0.3 + rand() * 0.6),
        affinity,
        tags: pickDistinct(rand, TASTE.brand, 2),
        explanation: opts.explain ? explain(rand, affinity) : undefined,
      } satisfies RelatedEntity;
    });
    const status: ToolStatus = n < take ? "partial" : "ok";
    return this.envelope(status, data, req, ctx, status === "partial" ? `${n} of ${take} requested` : undefined);
  }

  async places(
    entityId: string,
    opts: { locationQuery: string; tagIds?: string[]; minPopularity?: number; take?: number; explain?: boolean },
  ): Promise<ToolResult<RelatedEntity[]>> {
    const take = Math.min(50, Math.max(1, opts.take ?? 10));
    const req = qlooRequests.places(entityId, { ...opts, take });
    const ctx = { actIds: [entityId] };
    if (isUnknown(entityId)) return this.envelope("empty", [], req, ctx, "no places");
    const rand = seededRandom(`places|${entityId}|${opts.locationQuery}|${(opts.tagIds ?? []).join(",")}`);
    const cityName = opts.locationQuery.split(",")[0].trim();
    const type = typeFromId(entityId);
    const n = Math.min(VENUE_NOUNS.length, isObscure(entityId) ? 2 : THIN_TYPES.has(type) ? Math.max(1, take - 2) : take);
    const floor = opts.minPopularity ?? 0;
    const data = pickDistinct(rand, VENUE_NOUNS, n).map((noun, i) => {
      const name = `${cityName} ${noun}`;
      const affinity = r2(0.92 - i * 0.03 - rand() * 0.02);
      return {
        id: `mock-place-${slug(name)}`,
        name,
        type: "urn:entity:place",
        popularity: r2(floor + (1 - floor) * (0.2 + rand() * 0.75)),
        affinity,
        tags: pickDistinct(rand, PLACE_TAGS, 2),
        explanation: opts.explain ? explain(rand, affinity, cityName) : undefined,
      } satisfies RelatedEntity;
    });
    const status: ToolStatus = n < take ? "partial" : "ok";
    return this.envelope(status, data, req, ctx, status === "partial" ? `${n} of ${take} requested` : undefined);
  }

  async tasteTags(entityId: string, opts: { take?: number } = {}): Promise<ToolResult<TagRef[]>> {
    const take = Math.min(50, Math.max(1, opts.take ?? 20));
    const req = qlooRequests.tasteTags(entityId, take, true);
    const ctx = { actIds: [entityId] };
    if (isUnknown(entityId)) return this.envelope("empty", [], req, ctx, "no tags");
    const type = typeFromId(entityId);
    const rand = seededRandom(`taste|${entityId}`);
    const pool = TASTE[type];
    const n = Math.min(take, isObscure(entityId) ? 2 : THIN_TYPES.has(type) ? Math.min(pool.length, 5) : pool.length);
    const data = pickDistinct(rand, pool, n).map((name) => mockTag(name, TAG_TYPE[type]));
    return this.envelope("ok", data, req, ctx);
  }
}

// ---------- helpers ----------

function uniqueNames(rand: () => number, n: number, gen: () => string): string[] {
  const out: string[] = [];
  for (let guard = 0; out.length < n && guard < n * 20; guard++) {
    const name = gen();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function explain(rand: () => number, affinity: number, place?: string): string {
  const influence = Math.round(70 + rand() * 30);
  return `Driven by the act's audience${place ? ` in ${place}` : ""} (influence ${influence}%, affinity ${affinity.toFixed(2)}).`;
}

/**
 * Synthetic heatmap cells around the city centroid. Affinity is uniform-ish per (act, city); popularity tracks metro
 * size with noise, so small metros skew low-popularity (the "primed, untapped" quadrant) without being guaranteed it.
 */
function synthCells(rand: () => number, city: CityPoolEntry, type: ActType, tagSeeded: boolean): HeatmapCell[] {
  const metro = city.metroM ?? 1;
  const sizeSignal = Math.log(metro + 0.5) / Math.log(21); // ~0 for 0.5M, ~1 for 20M
  const baseAffinity = clamp01((0.3 + rand() * 0.65) * (tagSeeded ? 0.92 : 1));
  const basePopularity = clamp01(0.08 + 0.75 * sizeSignal + (rand() - 0.5) * 0.4);
  const n = THIN_TYPES.has(type) ? 8 + Math.floor(rand() * 7) : 16 + Math.floor(rand() * 15);
  const cells: HeatmapCell[] = [];
  for (let i = 0; i < n; i++) {
    const affinity = clamp01(baseAffinity + 0.04 - i * 0.012 + (rand() - 0.5) * 0.02);
    cells.push({
      lat: r4(city.lat + (rand() - 0.5) * 0.3),
      lon: r4(city.lon + (rand() - 0.5) * 0.4),
      affinity: r4(affinity),
      affinityRank: r4(clamp01(affinity * 0.97 + rand() * 0.03)),
      popularity: r4(clamp01(basePopularity + (rand() - 0.5) * 0.2)),
    });
  }
  return cells;
}
