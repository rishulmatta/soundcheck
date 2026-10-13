import { describe, expect, it, vi } from "vitest";
import type { CityPoolEntry } from "@/lib/types";
import { MemoryCache } from "./cache";
import { QlooHttpClient } from "./client";
import { LiveQlooClient } from "./live";
import { aggregateHeatmap } from "./schemas";

// Synthetic payloads shaped like the documented responses. Not real Qloo data.
const ACT = "00000000-0000-4000-8000-000000000001";
const OPENER = "00000000-0000-4000-8000-000000000002";
const BOISE: CityPoolEntry = { id: "boise", name: "Boise", country: "US", lat: 43.62, lon: -116.21, metroM: 0.8 };

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

  it('falls back to a tag seed and returns "degraded" when the act heatmap is empty', async () => {
    const cells = [
      { location: { latitude: 43.6, longitude: -116.2, geohash: "9rwm" }, query: { affinity: 0.8, affinity_rank: 0.7, popularity: 0.2 } },
      { location: { latitude: 43.61, longitude: -116.22, geohash: "9rwn" }, query: { affinity: 0.6, affinity_rank: 0.5, popularity: 0.4 } },
    ];
    const { client, calls } = setup([
      json({ success: true, results: { heatmap: [] } }),
      json({ success: true, results: { heatmap: cells }, query: { localities: { filter: { name: "Boise", disambiguation: "Boise, Idaho, United States" } } } }),
    ]);
    const res = await client.heatmapForCity({ entityIds: [ACT], tagIds: ["urn:tag:genre:music:indie"] }, BOISE);
    expect(res.status).toBe("degraded");
    expect(calls).toHaveLength(2);
    expect(res.meta.request).toBe("GET /v2/insights?filter.type=urn:heatmap&filter.location.query=Boise&signal.interests.tags=[tags]&take=50");
    expect(res.data.cells).toHaveLength(2);
    expect(res.data.affinity).toBeCloseTo(0.7);
    expect(res.data.popularity).toBeCloseTo(0.3);
  });

  it('marks a heatmap "partial" and retries qualified when the locality lands in another country', async () => {
    const cell = { location: { latitude: 1, longitude: 1 }, query: { affinity: 0.5, affinity_rank: 0.5, popularity: 0.5 } };
    const { client, calls } = setup([
      json({ results: { heatmap: [cell] }, query: { localities: { filter: { disambiguation: "Boise, Somewhere, Elsewhere" } } } }),
      json({ results: { heatmap: [cell] }, query: { localities: { filter: { disambiguation: "Boise, Idaho, United States" } } } }),
    ]);
    const res = await client.heatmapForCity({ entityIds: [ACT] }, BOISE);
    expect(calls[1].url).toContain("filter.location.query=Boise,%20United%20States");
    expect(res.status).toBe("ok");
    expect(res.meta.note).toContain("locality mismatch");
  });

  it("maps a 400 to empty with the API message and does not retry", async () => {
    const { client, fetchImpl } = setup([json({ error: "No localities found" }, 400), json({ error: "No localities found" }, 400)]);
    const res = await client.heatmapForCity({ entityIds: [ACT] }, BOISE);
    expect(res.status).toBe("empty");
    expect(res.meta.note).toContain("No localities found");
    // one call for "Boise", one qualified retry for "Boise, United States"; neither is retried with backoff
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("derives taste similarity from per-side scores without claiming a shared-fan percentage", async () => {
    const { client } = setup([
      json({
        results: [
          { name: "Indie", query: { a: { affinity: 0.8 }, b: { affinity: 0.4 } } },
          { name: "Dream Pop", query: { a: { affinity: 0.6 }, b: { affinity: 0.6 } } },
        ],
      }),
    ]);
    const res = await client.compareAudiences(ACT, OPENER, "artist");
    expect(res.status).toBe("ok");
    expect(res.data.overlap).toBeCloseTo(0.75);
    expect(res.data.sharedTags).toEqual(["Dream Pop", "Indie"]);
    expect(res.meta.note).toContain("not measured shared-fan overlap");
  });

  it("does not reinterpret an undocumented top-level score as measured audience overlap", async () => {
    const { client } = setup([json({ results: { overlap: 0.9, similarity: 0.8, score: 0.7 } })]);
    const res = await client.compareAudiences(ACT, OPENER, "artist");
    expect(res.status).not.toBe("ok");
    expect(res.data.overlap).toBe(0);
    expect(res.meta.note).toContain("No usable per-side scores");
  });

  it("aggregates the top-N cells by affinity", () => {
    const cells = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: 0, affinity: 1 - i * 0.05, affinityRank: 0.5, popularity: i < 10 ? 0.2 : 0.9 }));
    const agg = aggregateHeatmap(cells, 10);
    expect(agg.affinity).toBeCloseTo(0.775);
    expect(agg.popularity).toBeCloseTo(0.2);
  });
});
