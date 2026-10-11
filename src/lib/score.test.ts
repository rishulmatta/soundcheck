import { describe, expect, it } from "vitest";
import type { CityHeatmap } from "@/lib/qloo/contract";
import { quadrantOf, scoreCities, underservedScore } from "@/lib/score";

const hm = (id: string, affinity: number, popularity: number): CityHeatmap => ({
  city: { id, name: id[0].toUpperCase() + id.slice(1), country: "US", lat: 40, lon: -100 },
  affinity,
  affinityRank: 1,
  popularity,
  cells: [],
});

describe("underservedScore", () => {
  it("weights affinity and inverse popularity above the gate", () => {
    expect(underservedScore(0.91, 0.22)).toBe(0.86); // matches the sample fixture (Boise)
    expect(underservedScore(0.88, 0.9)).toBe(0.57); // Chicago
  });
  it("drops the popularity bonus below the affinity gate", () => {
    expect(underservedScore(0.4, 0)).toBe(0.24);
    expect(underservedScore(0.4, 0)).toBeLessThan(underservedScore(0.5, 1));
  });
  it("clamps out-of-range and non-finite input", () => {
    expect(underservedScore(2, -1)).toBe(1);
    expect(underservedScore(Number.NaN, 0.5)).toBe(0);
  });
});

describe("quadrantOf", () => {
  it("classifies the three quadrants on the 0.7 / 0.5 thresholds", () => {
    expect(quadrantOf(0.7, 0.49)).toBe("untapped");
    expect(quadrantOf(0.7, 0.5)).toBe("established");
    expect(quadrantOf(0.69, 0.1)).toBe("reach");
  });
});

describe("scoreCities", () => {
  it("ranks by affinity, scores, and carries status", () => {
    const rows = scoreCities([
      { ...hm("chicago", 0.88, 0.9) },
      { ...hm("boise", 0.91, 0.22), status: "degraded" },
      hm("tulsa", 0.3, 0.1),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["boise", "chicago", "tulsa"]);
    expect(rows.map((r) => r.affinityRank)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ quadrant: "untapped", underserved: 0.86, status: "degraded" });
    expect(rows[1]).toMatchObject({ quadrant: "established", status: "ok" });
    expect(rows[2].quadrant).toBe("reach");
  });
  it("breaks affinity ties by lower popularity", () => {
    const rows = scoreCities([hm("a", 0.8, 0.9), hm("b", 0.8, 0.2)]);
    expect(rows[0].id).toBe("b");
  });
  it("returns an empty list for no heatmaps", () => {
    expect(scoreCities([])).toEqual([]);
  });
});
