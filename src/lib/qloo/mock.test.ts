import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolMeta, ToolStatus } from "@/lib/types";
import { getCityPool } from "@/data/cities";
import { regionPolygonWkt } from "@/lib/geo";
import { encodeQueryValue } from "./redact";
import { getQloo, QLOO_CALL_TYPES, qlooMode, resetQlooForTests } from "./index";
import { LiveQlooClient } from "./live";
import { MockQlooClient } from "./mock";

const mock = new MockQlooClient();
const ACT = "mock-artist-the-example-band";

function expectEnvelope(res: { status: unknown; meta: unknown }) {
  expect(ToolStatus.safeParse(res.status).success).toBe(true);
  expect(ToolMeta.safeParse(res.meta).success).toBe(true);
}

describe("MockQlooClient", () => {
  it("is deterministic across instances and calls", async () => {
    const other = new MockQlooClient();
    const pool = getCityPool("north-america");
    expect(await mock.searchEntity("The Example Band", "artist")).toEqual(await other.searchEntity("The Example Band", "artist"));
    expect(await mock.heatmapForCities({ entityIds: [ACT] }, pool, "north-america")).toEqual(
      await other.heatmapForCities({ entityIds: [ACT] }, pool, "north-america"),
    );
    // a city's values depend only on (seed, city), not on the rest of the set
    const whole = await mock.heatmapForCities({ entityIds: [ACT] }, pool, "north-america");
    const pair = await mock.heatmapForCities({ entityIds: [ACT] }, [pool[3], pool[0]], "north-america");
    expect(pair.data.cities).toEqual([whole.data.cities[3], whole.data.cities[0]]);
    expect(await mock.relatedActs(ACT, "artist", { locationQuery: "Boise", take: 5, explain: true })).toEqual(
      await other.relatedActs(ACT, "artist", { locationQuery: "Boise", take: 5, explain: true }),
    );
    expect(await mock.trending(ACT, "artist")).toEqual(await other.trending(ACT, "artist"));
  });

  it("resolves acts to stable ids that later calls understand", async () => {
    const res = await mock.searchEntity("The Example Band", "artist");
    expect(res.status).toBe("ok");
    expect(res.data[0]).toMatchObject({ id: ACT, name: "The Example Band", type: "artist" });
    expect(res.meta.request).toBe("GET /search?query=[act]&types=urn:entity:artist&take=5");
    expectEnvelope(res);
  });

  it("spreads a city pool across all four affinity/popularity quadrants", async () => {
    const pool = getCityPool("north-america");
    const res = await mock.heatmapForCities({ entityIds: [ACT] }, pool, "north-america");
    expect(res.status).toBe("ok");
    expectEnvelope(res);
    const scored = res.data.cities;
    expect(scored.length).toBe(pool.length);
    expect(res.data.cellCount).toBe(scored.reduce((n, c) => n + c.cells.length, 0));
    const quadrants = new Set(scored.map((d) => `${d.affinity >= 0.6 ? "hi" : "lo"}-${d.popularity >= 0.5 ? "hi" : "lo"}`));
    expect(quadrants).toEqual(new Set(["hi-hi", "hi-lo", "lo-hi", "lo-lo"]));
    for (const d of scored) {
      expect(d.cells.length).toBeGreaterThan(0);
      for (const v of [d.affinity, d.affinityRank, d.popularity]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(res.meta.request).toBe(
      `GET /v2/insights?filter.type=urn:heatmap&filter.location=${encodeQueryValue(regionPolygonWkt(pool))}&signal.interests.entities=[act]`,
    );
    expect(res.meta.note).toContain("region-normalized: one heatmap query for north-america");
  });

  it("exercises fallbacks for obscure and unknown acts", async () => {
    const obscure = "mock-artist-an-obscure-act";
    const pool = getCityPool("north-america");
    expect((await mock.searchEntity("An Unknown Act", "artist")).status).toBe("empty");
    const empty = await mock.heatmapForCities({ entityIds: [obscure] }, pool, "north-america");
    expect(empty.status).toBe("empty");
    expect(empty.data.cities).toHaveLength(pool.length);
    expect(empty.data.cities.every((c) => c.cells.length === 0)).toBe(true);
    const fallback = await mock.heatmapForCities({ entityIds: [obscure], tagIds: ["urn:tag:mock:indie_rock"] }, pool, "north-america");
    expect(fallback.status).toBe("degraded");
    expect(fallback.meta.request).toContain("signal.interests.tags=[tags]");
    expect(fallback.meta.note).toContain("fallback: seeded by genre/taste tags, not the act");
    expect((await mock.relatedActs(obscure, "artist", { take: 5 })).status).toBe("partial");
    expect((await mock.trending(obscure, "artist")).status).toBe("empty");
  });

  it("leaves some cities without cells for thin act types and names them", async () => {
    const pool = getCityPool("north-america");
    const res = await mock.heatmapForCities({ entityIds: ["mock-person-dana-moss"] }, pool, "north-america");
    const uncovered = res.data.cities.filter((c) => c.cells.length === 0);
    expect(uncovered.length).toBeGreaterThan(0);
    expect(res.status).toBe("partial");
    expect(res.meta.note).toContain(`no cells within 40 km of: ${uncovered.map((c) => c.city.name).join(", ")}`);
  });

  it("gives comedians and podcasts thinner data than artists", async () => {
    const opts = { locationQuery: "Omaha", take: 6 };
    const artist = await mock.relatedActs(ACT, "artist", opts);
    const comic = await mock.relatedActs("mock-person-dana-moss", "person", opts);
    const pod = await mock.relatedActs("mock-podcast-small-hours-radio", "podcast", opts);
    expect(artist.status).toBe("ok");
    expect(comic.status).toBe("partial");
    expect(pod.data.length).toBeLessThan(artist.data.length);
  });

  it("returns contract-shaped data for every method", async () => {
    const all = [
      await mock.findTags("afterparty"),
      await mock.heatmapForCities({ entityIds: [ACT] }, getCityPool("uk-ireland"), "uk-ireland"),
      await mock.demographics({ entityIds: [ACT] }),
      await mock.trending(ACT, "artist"),
      await mock.relatedActs(ACT, "artist", { take: 3, explain: true }),
      await mock.compareAudiences(ACT, "mock-artist-harbor-lights", "artist"),
      await mock.brands(ACT, { ageBuckets: ["25_to_29"], take: 3, explain: true }),
      await mock.places(ACT, { locationQuery: "London", take: 3 }),
      await mock.tasteTags(ACT),
    ];
    all.forEach(expectEnvelope);
    const demo = await mock.demographics({ entityIds: [ACT] });
    expect(demo.data.age.map((a) => a.bucket)).toEqual(["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"]);
    const cmp = await mock.compareAudiences(ACT, "mock-artist-harbor-lights", "artist");
    expect(cmp.data.overlap).toBeGreaterThan(0);
    expect(cmp.data.overlap).toBeLessThanOrEqual(1);
    const rel = await mock.relatedActs(ACT, "artist", { take: 3, explain: true });
    expect(rel.data.every((r) => typeof r.explanation === "string")).toBe(true);
  });
});

describe("getQloo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetQlooForTests();
  });

  it("uses the mock when QLOO_MOCK=1, even with a key", () => {
    vi.stubEnv("QLOO_MOCK", "1");
    vi.stubEnv("QLOO_API_KEY", "abc12345678");
    expect(qlooMode()).toBe("mock");
    expect(getQloo()).toBeInstanceOf(MockQlooClient);
  });

  it("falls back to the mock with one warning when the key is missing", () => {
    vi.stubEnv("QLOO_MOCK", "");
    vi.stubEnv("QLOO_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getQloo()).toBeInstanceOf(MockQlooClient);
    getQloo();
    getQloo();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("uses the live client when a key is set and mock is off", () => {
    vi.stubEnv("QLOO_MOCK", "0");
    vi.stubEnv("QLOO_API_KEY", "abc12345678");
    expect(getQloo()).toBeInstanceOf(LiveQlooClient);
  });

  it("lists at least ten distinct call types", () => {
    const ids = QLOO_CALL_TYPES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });
});
