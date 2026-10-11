import { describe, expect, it } from "vitest";
import { buildLegs, greatCircle, haversineKm, lineLengthKm, lineSliceAlong, routeHead, routeProgress, type LngLat } from "./geo";
import { easeInOut, easeOut } from "./ease";

const seattle: LngLat = [-122.33, 47.61];
const boise: LngLat = [-116.21, 43.62];
const slc: LngLat = [-111.89, 40.76];

describe("haversineKm", () => {
  it("matches known distances", () => {
    expect(haversineKm(seattle, boise)).toBeGreaterThan(600);
    expect(haversineKm(seattle, boise)).toBeLessThan(660);
    expect(haversineKm(seattle, seattle)).toBe(0);
    expect(haversineKm([0, 0], [0, 1])).toBeCloseTo(111.2, 0);
  });
});

describe("lineSliceAlong", () => {
  const line: LngLat[] = [[0, 0], [0, 1], [0, 2]];
  const total = lineLengthKm(line);
  it("slices from the start", () => {
    const part = lineSliceAlong(line, 0, total / 2);
    expect(part[0]).toEqual([0, 0]);
    expect(part[part.length - 1][1]).toBeCloseTo(1, 4);
    expect(lineLengthKm(part)).toBeCloseTo(total / 2, 3);
  });
  it("cuts mid-segment and keeps interior vertices", () => {
    const part = lineSliceAlong(line, total * 0.25, total * 0.75);
    expect(part).toHaveLength(3);
    expect(part[0][1]).toBeCloseTo(0.5, 4);
    expect(part[1]).toEqual([0, 1]);
    expect(part[2][1]).toBeCloseTo(1.5, 4);
  });
  it("clamps past the end", () => {
    const part = lineSliceAlong(line, 0, total * 10);
    expect(part[part.length - 1]).toEqual([0, 2]);
  });
});

describe("greatCircle", () => {
  it("pins both ends and keeps length close to the haversine distance", () => {
    const gc = greatCircle(seattle, slc, 32);
    expect(gc).toHaveLength(33);
    expect(gc[0]).toEqual(seattle);
    expect(gc[32]).toEqual(slc);
    expect(lineLengthKm(gc)).toBeCloseTo(haversineKm(seattle, slc), 0);
  });
});

describe("routeProgress", () => {
  const legs = buildLegs([seattle, boise, slc], 24);
  it("is empty for the first stop", () => {
    expect(routeProgress(legs, 1, 1)).toEqual([]);
    expect(routeHead(legs, 1, 1)).toBeNull();
  });
  it("draws part of the incoming leg", () => {
    const half = routeProgress(legs, 2, 0.5);
    expect(half[0]).toEqual(seattle);
    expect(lineLengthKm(half)).toBeCloseTo(lineLengthKm(legs[0]) / 2, 1);
    expect(routeHead(legs, 2, 0.5)).toEqual(half[half.length - 1]);
  });
  it("keeps earlier legs complete and appends the partial one", () => {
    const part = routeProgress(legs, 3, 0.25);
    const expected = lineLengthKm(legs[0]) + lineLengthKm(legs[1]) * 0.25;
    expect(lineLengthKm(part)).toBeCloseTo(expected, 1);
    const full = routeProgress(legs, 3, 1);
    expect(full[full.length - 1]).toEqual(slc);
    expect(lineLengthKm(full)).toBeCloseTo(lineLengthKm(legs[0]) + lineLengthKm(legs[1]), 1);
  });
});

describe("easing", () => {
  it("hits the endpoints and stays monotone for the travel curve", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 2);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const y = easeInOut(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
  it("ease-out front-loads", () => {
    expect(easeOut(0.2)).toBeGreaterThan(0.5);
  });
});
