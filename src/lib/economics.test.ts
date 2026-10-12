import { describe, expect, it } from "vitest";
import { Plan, type Stop } from "@/lib/types";
import sample from "@/fixtures/plan.sample.json";
import { TIER_RATES, formatMoney, ratesFor, roadDistance, routeEconomics, stopBreakEven, suggestCapacity, unitsFor } from "@/lib/economics";

const plan = Plan.parse(sample);
const bus = TIER_RATES.bus;

describe("roadDistance", () => {
  it("scales the great circle by the road factor and converts to the unit", () => {
    const seattle = { lat: 47.61, lon: -122.33 };
    const boise = { lat: 43.62, lon: -116.21 };
    const mi = roadDistance(seattle, boise, "mi");
    const km = roadDistance(seattle, boise, "km");
    expect(mi).toBeGreaterThan(480); // straight line is ~400 mi
    expect(mi).toBeLessThan(560);
    expect(km / mi).toBeCloseTo(1.609, 1);
  });
});

describe("routeEconomics", () => {
  it("prices every road leg and adds a daily cost for every show and travel day", () => {
    const e = routeEconomics(plan.stops, bus, "mi");
    expect(e.legs).toHaveLength(plan.stops.length - 1);
    expect(e.showDays).toBe(plan.stops.length);
    expect(e.travelDays).toBe(plan.stops.reduce((n, s) => n + s.legDays, 0));
    expect(e.crewDays).toBe((e.showDays + e.travelDays) * bus.crew);
    const roadLegs = e.legs.filter((l) => !l.flight);
    const expected = roadLegs.reduce((n, l) => n + l.distance * bus.perUnit + l.days * bus.perDay, 0) + e.showDays * bus.perDay;
    expect(e.travelCost).toBeCloseTo(expected, -1);
    expect(e.totalDistance).toBe(e.legs.reduce((n, l) => n + l.distance, 0));
  });

  it("flags legs over the tier threshold as flights and leaves them unpriced", () => {
    const far: Stop[] = [plan.stops[0], { ...plan.stops[1], city: { ...plan.stops[1].city, lat: 40.71, lon: -74.01 }, legDays: 3 }];
    const e = routeEconomics(far, bus, "mi");
    expect(e.legs[0].flight).toBe(true);
    expect(e.legs[0].cost).toBe(0);
    expect(e.flightLegs).toBe(1);
    expect(e.longestLeg?.to).toBe(far[1].order);
    // Show days still cost; the flight itself does not.
    expect(e.travelCost).toBe(2 * bus.perDay);
  });

  it("handles a single stop", () => {
    const e = routeEconomics([plan.stops[0]], bus, "mi");
    expect(e.legs).toEqual([]);
    expect(e.longestLeg).toBeUndefined();
    expect(e.travelCost).toBe(bus.perDay);
  });
});

describe("stopBreakEven", () => {
  it("covers the leg in plus one show day at the suggested room", () => {
    const e = routeEconomics(plan.stops, bus, "mi");
    const leg = e.legs.find((l) => !l.flight)!;
    const stop = plan.stops.find((s) => s.order === leg.to)!;
    const b = stopBreakEven(stop, plan.act.popularity, bus, leg);
    expect(b.capacity).toBe(suggestCapacity(stop.city, plan.act.popularity));
    expect(b.cost).toBe(leg.cost + bus.perDay);
    expect(b.tickets).toBe(Math.ceil(b.cost! / bus.avgTicket));
    expect(b.sellThrough).toBeCloseTo(b.tickets! / b.capacity, 6);
    expect(b.gross).toBe(b.capacity * bus.avgTicket);
  });

  it("gives no ticket count when the leg in is a flight", () => {
    const b = stopBreakEven(plan.stops[1], 0.7, bus, { to: 2, from: "A", toName: "B", distance: 900, days: 3, flight: true, cost: 0 });
    expect(b.cost).toBeUndefined();
    expect(b.tickets).toBeUndefined();
    expect(b.capacity).toBeGreaterThan(0);
  });

  it("the first stop has only the show day to cover", () => {
    const b = stopBreakEven(plan.stops[0], 0.5, bus, undefined);
    expect(b.cost).toBe(bus.perDay);
  });
});

describe("suggestCapacity", () => {
  it("rounds to 50 under 1,000 and to 100 above, within 150..6000", () => {
    expect(suggestCapacity({ metroM: 0.2, affinity: 0.2, popularity: 0.1 }, 0.1)).toBe(150);
    expect(suggestCapacity({ metroM: 100, affinity: 1, popularity: 1 }, 1)).toBe(6000);
    const mid = suggestCapacity({ metroM: 1.5, affinity: 0.8, popularity: 0.3 }, 0.6);
    expect(mid % 50).toBe(0);
  });
});

describe("units and money", () => {
  it("maps regions to distance unit and currency", () => {
    expect(unitsFor("north-america")).toEqual({ unit: "mi", currency: "USD" });
    expect(unitsFor("uk-ireland")).toEqual({ unit: "mi", currency: "GBP" });
    expect(unitsFor("europe")).toEqual({ unit: "km", currency: "EUR" });
  });
  it("converts the per-mile defaults for km regions", () => {
    const eu = ratesFor("bus", unitsFor("europe"));
    expect(eu.perUnit).toBeCloseTo(TIER_RATES.bus.perUnit * 0.621, 1);
    expect(eu.flightLeg).toBe(1300);
    expect(ratesFor("bus", unitsFor("north-america"))).toEqual(TIER_RATES.bus);
  });
  it("formats whole currency amounts", () => {
    expect(formatMoney(12345.6, "USD")).toBe("$12,346");
    expect(formatMoney(900, "GBP")).toBe("£900");
    expect(formatMoney(2.4, "USD", 2)).toBe("$2.40");
    expect(formatMoney(3200, "USD", 2)).toBe("$3,200");
  });
});
