import { describe, expect, it } from "vitest";
import type { CityScore } from "@/lib/types";
import { haversineKm, legDaysFor, pathKm, routeTour } from "@/lib/routing";

const city = (id: string, lat: number, lon: number, underserved: number): CityScore => ({
  id,
  name: id.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
  country: "US",
  lat,
  lon,
  affinity: 0.8,
  affinityRank: 1,
  popularity: 0.5,
  underserved,
  quadrant: "established",
  status: "ok",
});

const cities: CityScore[] = [
  city("seattle", 47.61, -122.33, 0.62),
  city("boise", 43.62, -116.21, 0.86),
  city("salt-lake-city", 40.76, -111.89, 0.74),
  city("denver", 39.74, -104.99, 0.65),
  city("omaha", 41.26, -95.94, 0.82),
  city("chicago", 41.88, -87.63, 0.57),
  city("new-york", 40.71, -74.01, 0.52),
  city("atlanta", 33.75, -84.39, 0.4),
  city("tulsa", 36.15, -95.99, 0.8),
  city("los-angeles", 34.05, -118.24, 0.51),
];

describe("haversineKm / legDaysFor", () => {
  it("computes great-circle distance", () => {
    expect(haversineKm({ lat: 40.71, lon: -74.01 }, { lat: 41.88, lon: -87.63 })).toBeGreaterThan(1100);
    expect(haversineKm({ lat: 40.71, lon: -74.01 }, { lat: 41.88, lon: -87.63 })).toBeLessThan(1200);
  });
  it("maps distance to travel days", () => {
    expect(legDaysFor(499)).toBe(1);
    expect(legDaysFor(500)).toBe(2);
    expect(legDaysFor(1499)).toBe(2);
    expect(legDaysFor(1500)).toBe(3);
  });
});

describe("routeTour", () => {
  it("picks the top N by underserved and starts from the westernmost city", () => {
    const { order, legDays } = routeTour(cities, { stops: 4, locked: [], excluded: [] });
    expect(order.map((c) => c.id).sort()).toEqual(["boise", "omaha", "salt-lake-city", "tulsa"]);
    expect(order[0].id).toBe("boise");
    expect(legDays).toHaveLength(4);
    expect(legDays[0]).toBe(0);
    for (let i = 1; i < order.length; i++) expect(legDays[i]).toBe(legDaysFor(haversineKm(order[i - 1], order[i])));
  });

  it("forces locked cities in, starts at the first locked city, and matches by name or id", () => {
    const { order } = routeTour(cities, { stops: 4, locked: ["New York", "atlanta"], excluded: [] });
    const ids = order.map((c) => c.id);
    expect(ids).toContain("new-york");
    expect(ids).toContain("atlanta");
    expect(ids).toHaveLength(4);
    expect(order[0].id).toBe("new-york");
  });

  it("never includes excluded cities, even when locked", () => {
    const { order } = routeTour(cities, { stops: 5, locked: ["boise"], excluded: ["Boise", "omaha"] });
    const ids = order.map((c) => c.id);
    expect(ids).not.toContain("boise");
    expect(ids).not.toContain("omaha");
    expect(ids).toHaveLength(5);
  });

  it("keeps every locked city when there are more locks than stops", () => {
    const { order } = routeTour(cities, { stops: 3, locked: ["seattle", "denver", "chicago", "atlanta"], excluded: [] });
    expect(order).toHaveLength(4);
  });

  it("produces a path no longer than plain nearest-neighbour order would", () => {
    const { order } = routeTour(cities, { stops: 10, locked: [], excluded: [] });
    expect(order).toHaveLength(10);
    expect(new Set(order.map((c) => c.id)).size).toBe(10);
    expect(order[0].id).toBe("seattle");
    // A west-to-east sweep is a sensible upper bound for this set.
    const sweep = [...order].sort((a, b) => a.lon - b.lon);
    expect(pathKm(order)).toBeLessThanOrEqual(pathKm(sweep) + 1);
  });

  it("handles empty input", () => {
    expect(routeTour([], { stops: 5, locked: [], excluded: [] })).toEqual({ order: [], legDays: [] });
  });
});
