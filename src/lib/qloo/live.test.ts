import { describe, expect, it, vi } from "vitest";
import type { CityPoolEntry } from "@/lib/types";
import { MemoryCache } from "./cache";
import { QlooHttpClient } from "./client";
import { LiveQlooClient } from "./live";
import { aggregateHeatmap, toCompare, toRegionHeatmap } from "./schemas";

// Synthetic payloads shaped like the documented responses. Not real Qloo data.
const ACT = "00000000-0000-4000-8000-000000000001";
const OPENER = "00000000-0000-4000-8000-000000000002";
const BOISE: CityPoolEntry = { id: "boise", name: "Boise", country: "US", lat: 43.62, lon: -116.21, metroM: 0.8 };
const MERIDIAN: CityPoolEntry = { id: "meridian", name: "Meridian", country: "US", lat: 43.61, lon: -116.39, metroM: 0.1 };
const SPOKANE: CityPoolEntry = { id: "spokane", name: "Spokane", country: "US", lat: 47.66, lon: -117.43, metroM: 0.6 };
const CITIES = [BOISE, MERIDIAN, SPOKANE];
/** regionPolygonWkt(CITIES), percent-encoded as the client sends it. */
const POLYGON_QS = "POLYGON((-119%2042,-115%2042,-115%2049,-119%2049,-119%2042))";

const cell = (lat: number, lon: number, affinity: number, popularity = 0.5) => ({
  location: { latitude: lat, longitude: lon, geohash: "9rwm" },
  query: { affinity, affinity_rank: affinity, popularity },
});
/** c1 sits on Boise and is ~14 km from Meridian (counts for both); c2 is ~33 km from Meridian, ~48 km from Boise; c3 is far from all. */
const REGION_CELLS = [cell(43.62, -116.21, 0.9, 0.2), cell(43.61, -116.8, 0.5, 0.6), cell(40, -100, 1, 1)];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(responses: Array<Response | Error>) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const cache = new MemoryCache();
  const http = new QlooHttpClient({ apiKey: "test-key-123456", fetchImpl: fetchImpl as unknown as typeof fetch, cache, sleep: async () => {} });
  const client = new LiveQlooClient({ http, now: () => new Date("2026-10-12T00:00:00Z") });
  return { client, calls, fetchImpl, cache };
}

const synthEntity = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  entity_id: id,
  name,
  type: "urn:entity",
  subtype: "urn:entity:artist",
  popularity: 0.5,
  tags: [{ id: "urn:tag:genre:music:indie", name: "Indie", type: "urn:tag:genre:music" }],
  ...extra,
});

describe("LiveQlooClient envelopes", () => {
  it("sends GET to the hackathon host with X-Api-Key and comma-joined params", async () => {
    const { client, calls } = setup([json({ success: true, results: { entities: [synthEntity(OPENER, "Synthetic Opener")] } })]);
    await client.relatedActs(ACT, "artist", { locationQuery: "Boise", take: 1, explain: true });
    expect(calls[0].url).toBe(
      `https://hackathon.api.qloo.com/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=${ACT}&signal.location.query=Boise&filter.exclude.entities=${ACT}&take=1&feature.explainability=true`,
    );
    expect(calls[0].headers.get("x-api-key")).toBe("test-key-123456");
    expect(calls[0].url).not.toContain("test-key");
  });

  it('maps 200 with empty entities to "empty" without throwing', async () => {
    const { client } = setup([json({ success: true, results: { entities: [] } })]);
    const res = await client.brands(ACT, { take: 5 });
    expect(res.status).toBe("empty");
    expect(res.data).toEqual([]);
    expect(res.meta.request).toBe("GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=[act]&take=5");
    expect(res.meta.note).toContain("returned no results");
  });

  it('returns "partial" when fewer items than requested come back', async () => {
    const { client } = setup([json({ results: { entities: [synthEntity("e1", "One"), synthEntity("e2", "Two")] } })]);
    const res = await client.brands(ACT, { take: 5 });
    expect(res.status).toBe("partial");
    expect(res.data.map((d) => d.name)).toEqual(["One", "Two"]);
  });

  it("sends one polygon heatmap query for the city set and marks uncovered cities partial", async () => {
    const { client, calls } = setup([json({ success: true, results: { heatmap: REGION_CELLS } })]);
    const res = await client.heatmapForCities({ entityIds: [ACT], tagIds: ["urn:tag:genre:music:indie"] }, CITIES, "north-america");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://hackathon.api.qloo.com/v2/insights?filter.type=urn:heatmap&filter.location=${POLYGON_QS}&signal.interests.entities=${ACT}`,
    );
    expect(calls[0].url).not.toContain("take=");
    expect(res.meta.request).toBe(`GET /v2/insights?filter.type=urn:heatmap&filter.location=${POLYGON_QS}&signal.interests.entities=[act]`);
    expect(res.status).toBe("partial");
    expect(res.meta.note).toContain("region-normalized: one heatmap query for north-america, 3 cells");
    expect(res.meta.note).toContain("no cells within 40 km of: Spokane");
    expect(res.data.polygon).toBe("POLYGON((-119 42,-115 42,-115 49,-119 49,-119 42))");
    expect(res.data.cities.map((c) => c.city.id)).toEqual(["boise", "meridian", "spokane"]);
    expect(res.data.cities.map((c) => c.cells.length)).toEqual([1, 2, 0]);
    expect(res.data.cities[1].affinity).toBeCloseTo(0.7);
  });

  it('returns "ok" when every city gets cells', async () => {
    const { client } = setup([json({ results: { heatmap: [...REGION_CELLS, cell(47.7, -117.4, 0.3)] } })]);
    const res = await client.heatmapForCities({ entityIds: [ACT] }, CITIES, "north-america");
    expect(res.status).toBe("ok");
    expect(res.meta.note).toBe("region-normalized: one heatmap query for north-america, 4 cells");
    expect(res.data.cellCount).toBe(4);
  });

  it('falls back to a tag seed and returns "degraded" when the act heatmap is empty', async () => {
    const { client, calls } = setup([json({ success: true, results: { heatmap: [] } }), json({ success: true, results: { heatmap: REGION_CELLS } })]);
    const res = await client.heatmapForCities({ entityIds: [ACT], tagIds: ["urn:tag:genre:music:indie"] }, CITIES, "north-america");
    expect(calls).toHaveLength(2);
    expect(res.status).toBe("degraded");
    expect(res.meta.request).toBe(`GET /v2/insights?filter.type=urn:heatmap&filter.location=${POLYGON_QS}&signal.interests.tags=[tags]`);
    expect(res.meta.note).toContain("fallback: seeded by genre/taste tags, not the act");
    expect(res.meta.note).toContain("no cells within 40 km of: Spokane");
    expect(res.data.cities[0].affinity).toBeCloseTo(0.9);
  });

  it('returns "empty" with zero rows for every city when the region has no cells', async () => {
    const { client, calls } = setup([json({ results: { heatmap: [] } }), json({ results: { heatmap: [] } })]);
    const res = await client.heatmapForCities({ entityIds: [ACT], tagIds: ["urn:tag:genre:music:indie"] }, CITIES, "north-america");
    expect(calls).toHaveLength(2);
    expect(res.status).toBe("empty");
    expect(res.data.cellCount).toBe(0);
    expect(res.data.cities).toHaveLength(3);
    expect(res.data.cities.every((c) => c.cells.length === 0 && c.affinity === 0)).toBe(true);
  });

  it("treats cells that reach no requested city as empty and tries the tag seed", async () => {
    const { client, calls } = setup([json({ results: { heatmap: [cell(40, -100, 1)] } }), json({ results: { heatmap: [] } })]);
    const res = await client.heatmapForCities({ entityIds: [ACT], tagIds: ["urn:tag:genre:music:indie"] }, CITIES, "north-america");
    expect(calls).toHaveLength(2);
    expect(res.status).toBe("empty");
    expect(res.meta.note).toContain("1 cells, none within 40 km of a requested city");
  });

  it("maps a 400 to empty with the API message and does not retry", async () => {
    const { client, fetchImpl } = setup([json({ error: "Invalid location" }, 400)]);
    const res = await client.heatmapForCities({ entityIds: [ACT] }, CITIES, "north-america");
    expect(res.status).toBe("empty");
    expect(res.meta.note).toContain("Invalid location");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns empty without calling Qloo when there is no seed or no city", async () => {
    const { client, fetchImpl } = setup([]);
    expect((await client.heatmapForCities({}, CITIES, "north-america")).status).toBe("empty");
    const none = await client.heatmapForCities({ entityIds: [ACT] }, [], "north-america");
    expect(none.status).toBe("empty");
    expect(none.data.cities).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries 429/5xx with backoff and reports "error" after 3 retries', async () => {
    const { client, fetchImpl } = setup([json({}, 429), json({}, 503), json({}, 500), json({}, 502)]);
    const res = await client.searchEntity("Synthetic Act", "artist");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(res.status).toBe("error");
    expect(res.data).toEqual([]);
  });

  it("recovers when a retry succeeds", async () => {
    const { client } = setup([new Error("ECONNRESET"), json({ success: true, results: [synthEntity(ACT, "Synthetic Act")] })]);
    const res = await client.searchEntity("Synthetic Act", "artist");
    expect(res.status).toBe("ok");
    expect(res.data[0]).toMatchObject({ id: ACT, name: "Synthetic Act", type: "artist" });
    expect(res.meta.request).toBe("GET /search?query=[act]&types=urn:entity:artist&take=5");
  });

  it('maps auth failures to "error" without retrying', async () => {
    const { client, fetchImpl } = setup([json({ error: "No API key found in request" }, 401)]);
    const res = await client.tasteTags(ACT);
    expect(res.status).toBe("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(res.meta.note).toContain("401");
  });

  it("uses search-specific type URNs for /search", async () => {
    const { client, calls } = setup([json({ results: [] })]);
    const res = await client.searchEntity("Synthetic Game", "video_game");
    expect(calls[0].url).toContain("types=urn:entity:videogame");
    expect(res.status).toBe("empty");
  });
});

describe("cache", () => {
  it("serves the second identical request from cache", async () => {
    const body = { results: { tags: [{ tag_id: "urn:tag:genre:music:indie", name: "Indie", subtype: "urn:tag:genre:music" }] } };
    const { client, fetchImpl } = setup([json(body)]);
    const first = await client.tasteTags(ACT, { take: 5 });
    const second = await client.tasteTags(ACT, { take: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.data).toEqual([{ id: "urn:tag:genre:music:indie", name: "Indie", type: "urn:tag:genre:music" }]);
  });

  it("does not cache failures", async () => {
    const { client, fetchImpl } = setup([json({}, 401), json({ results: { tags: [{ tag_id: "urn:tag:x", name: "X" }] } })]);
    expect((await client.findTags("x")).status).toBe("error");
    expect((await client.findTags("x")).status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caps the in-memory cache size", async () => {
    const cache = new MemoryCache(2);
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.get("a");
    await cache.set("c", 3);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(1);
    expect(cache.size).toBe(2);
  });
});

describe("response mapping", () => {
  it("parses demographics, preferring the act block", async () => {
    const { client } = setup([
      json({
        results: {
          demographics: [
            { entity_id: "urn:tag:genre:music:indie", query: { age: { "25_to_29": 0.1 }, gender: { male: 0.2, female: -0.2 } } },
            { entity_id: ACT, query: { age: { "24_and_younger": -0.1, "30_to_34": 0.7 }, gender: { male: -0.1, female: 0.1 } } },
          ],
        },
      }),
    ]);
    const res = await client.demographics({ entityIds: [ACT] });
    expect(res.status).toBe("ok");
    expect(res.data.age).toEqual([
      { bucket: "24_and_younger", score: -0.1 },
      { bucket: "30_to_34", score: 0.7 },
    ]);
    expect(res.data.gender).toEqual({ female: 0.1, male: -0.1 });
  });

  it("derives a trend from weekly percentiles", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-08-${String(10 + i).padStart(2, "0")}`,
      population_percentile: 60 + i * 2,
      population_rank_velocity: 3,
    })).reverse();
    const { client } = setup([json({ results: { trending: rows } })]);
    const res = await client.trending(ACT, "artist", { weeks: 8 });
    expect(res.status).toBe("ok");
    expect(res.data.trend).toBe("rising");
    expect(res.data.velocity).toBe(3);
    expect(res.data.series?.[0].date).toBe("2026-08-10");
  });

  it("writes an explanation from explainability scores", async () => {
    const { client } = setup([
      json({
        results: {
          entities: [synthEntity(OPENER, "Synthetic Opener", { query: { affinity: 0.91, explainability: { "signal.interests.entities": [{ entity_id: ACT, score: 0.87 }] } } })],
        },
      }),
    ]);
    const res = await client.relatedActs(ACT, "artist", { locationQuery: "Boise", take: 1, explain: true });
    expect(res.status).toBe("ok");
    expect(res.data[0].explanation).toBe("Recorded contribution from the act signal (score 0.87, affinity 0.91); requested location signal: Boise.");
    expect(res.data[0].affinity).toBeCloseTo(0.91);
  });

  it("notes the ~26-week floor when a short trending window comes back empty", async () => {
    const { client, calls } = setup([json({ results: { trending: [] } }), json({ results: { trending: [] } })]);
    const short = await client.trending(ACT, "artist", { weeks: 8 });
    expect(short.status).toBe("empty");
    expect(short.meta.note).toContain("Qloo returns no rows for windows under about 26 weeks");
    const long = await client.trending(ACT, "artist", { weeks: 26 });
    expect(calls[1].url).toContain("take=26");
    expect(long.status).toBe("empty");
    expect(long.meta.note ?? "").not.toContain("under about 26 weeks");
  });

  // Shaped like the live /v2/analysis/compare body: results.tags = shared (query.score), results.a / results.b = each
  // side's tags (query.count, as a string), matchEntities []. a and b repeat some shared tags; "x" is in both a and b.
  const tag = (id: string, name: string, query: Record<string, unknown>) => ({ tag_id: `urn:tag:t:${id}`, name, type: "urn:tag", query });
  const COMPARE_BODY = {
    duration: 12,
    results: {
      tags: [tag("soul", "Soul", { score: 0.9 }), tag("jazz", "Jazz", { score: 0.99 }), tag("funk", "Funk", { score: 0.6 })],
      a: [tag("soul", "Soul", { count: "1" }), tag("a1", "A1", { count: "1" }), tag("a2", "A2", { count: "1" }), tag("x", "X", { count: "1" })],
      b: [tag("jazz", "Jazz", { count: "1" }), tag("b1", "B1", { count: "1" }), tag("x", "X", { count: "1" })],
      matchEntities: [],
    },
  };

  it("derives a Jaccard taste-tag similarity from shared vs side-only tags", async () => {
    const { client } = setup([json(COMPARE_BODY)]);
    const res = await client.compareAudiences(ACT, OPENER, "artist");
    expect(res.status).toBe("ok");
    // shared {soul, jazz, funk, x} = 4; only A {a1, a2} = 2; only B {b1} = 1 → 4 / 7
    expect(res.data.overlap).toBe(0.57);
    expect(res.data.sharedTags).toEqual(["Jazz", "Soul", "Funk"]);
    expect(res.meta.note).toContain("4 shared, 2 only A, 1 only B");
    expect(res.meta.note).toContain("not measured shared-fan overlap");
  });

  it("caps shared tags at five and scores zero when nothing is shared", () => {
    const many = { results: { tags: Array.from({ length: 8 }, (_, i) => tag(`s${i}`, `S${i}`, { score: i / 10 })), a: [], b: [] } };
    expect(toCompare(many)?.data).toEqual({ overlap: 1, sharedTags: ["S7", "S6", "S5", "S4", "S3"] });
    const disjoint = toCompare({ results: { tags: [], a: [tag("a", "A", {})], b: [tag("b", "B", {})] } });
    expect(disjoint).toMatchObject({ scored: true, data: { overlap: 0, sharedTags: [] } });
  });

  it("does not reinterpret an undocumented top-level score as audience overlap", async () => {
    const { client } = setup([json({ results: { overlap: 0.9, similarity: 0.8, score: 0.7 } })]);
    const res = await client.compareAudiences(ACT, OPENER, "artist");
    expect(res.status).toBe("empty");
    expect(res.data.overlap).toBe(0);
    expect(res.meta.note).toContain("no shared/per-side tag lists");
  });

  it("assigns region cells to every city within the radius", () => {
    const parsed = toRegionHeatmap({ results: { heatmap: [...REGION_CELLS, { location: { latitude: 1 } }] } }, CITIES, "north-america", "P");
    expect(parsed?.cellCount).toBe(3);
    expect(parsed?.region).toBe("north-america");
    expect(parsed?.polygon).toBe("P");
    const [boise, meridian, spokane] = parsed!.cities;
    expect(boise.cells.map((c) => c.affinity)).toEqual([0.9]);
    expect(meridian.cells.map((c) => c.affinity)).toEqual([0.9, 0.5]);
    expect(meridian).toMatchObject({ affinity: 0.7, popularity: 0.4 });
    expect(spokane).toMatchObject({ cells: [], affinity: 0, affinityRank: 0, popularity: 0 });
    expect(toRegionHeatmap({ results: { heatmap: [] } }, CITIES, "north-america", "P")?.cities).toHaveLength(3);
  });

  it("aggregates the top-N cells by affinity", () => {
    const cells = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: 0, affinity: 1 - i * 0.05, affinityRank: 0.5, popularity: i < 10 ? 0.2 : 0.9 }));
    const agg = aggregateHeatmap(cells, 10);
    expect(agg.affinity).toBeCloseTo(0.775);
    expect(agg.popularity).toBeCloseTo(0.2);
  });
});
