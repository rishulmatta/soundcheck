import { describe, expect, it } from "vitest";
import { Plan, type Stop } from "@/lib/types";
import sample from "@/fixtures/plan.sample.json";
import { TIER_RATES, capacityBasis, formatMoney, marketMultiplier, metroCeiling, ratesFor, roadDistance, routeEconomics, staticEconomics, stopBreakEven, suggestCapacity, unitsFor } from "@/lib/economics";
import { resolveRoomTier, type ResolvedRoomTier } from "@/lib/room";

const plan = Plan.parse(sample);
const bus = TIER_RATES.bus;
const stated = (tier: ResolvedRoomTier["tier"]): ResolvedRoomTier => ({ tier, guessed: false });
const mid = stated("800to2000");

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
    const b = stopBreakEven(stop, mid, bus, leg);
    expect(b.capacity).toBe(suggestCapacity(stop.city, mid));
    expect(b.cost).toBe(leg.cost + bus.perDay);
    expect(b.tickets).toBe(Math.ceil(b.cost! / bus.avgTicket));
    expect(b.sellThrough).toBeCloseTo(b.tickets! / b.capacity, 6);
    expect(b.gross).toBe(b.capacity * bus.avgTicket);
  });

  it("gives no ticket count when the leg in is a flight", () => {
    const b = stopBreakEven(plan.stops[1], mid, bus, { to: 2, from: "A", toName: "B", distance: 900, days: 3, flight: true, cost: 0 });
    expect(b.cost).toBeUndefined();
    expect(b.tickets).toBeUndefined();
    expect(b.capacity).toBeGreaterThan(0);
  });

  it("the first stop has only the show day to cover", () => {
    const b = stopBreakEven(plan.stops[0], mid, bus, undefined);
    expect(b.cost).toBe(bus.perDay);
  });
});

describe("suggestCapacity", () => {
  const city = (affinity: number, popularity: number, metroM = 1) => ({ affinity, popularity, metroM });

  it("anchors on the stated tier: an established city at the affinity gate gets the anchor", () => {
    expect(suggestCapacity(city(0.5, 0.5), mid)).toBe(1300);
    expect(suggestCapacity(city(0.5, 0.5), stated("300to800"))).toBe(500);
  });

  it("separates tiers that Qloo popularity cannot tell apart", () => {
    const c = city(0.8, 0.8, 20); // a large metro, so the ceiling does not bind
    const sizes = (["under300", "300to800", "800to2000", "2000to5000", "over5000"] as const).map((t) => suggestCapacity(c, stated(t)));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(5);
  });

  it("moves established cities up to 1.3×, untapped to 0.7..0.9×, reach to 0.6×", () => {
    expect(marketMultiplier({ affinity: 0.5, popularity: 0.5 })).toBeCloseTo(1, 6);
    expect(marketMultiplier({ affinity: 1, popularity: 1 })).toBeCloseTo(1.3, 6);
    expect(marketMultiplier({ affinity: 0.8, popularity: 0.8 })).toBeCloseTo(1.18, 6);
    expect(marketMultiplier({ affinity: 0.9, popularity: 0.4 })).toBeCloseTo(0.86, 6);
    expect(marketMultiplier({ affinity: 1, popularity: 0.5 })).toBeCloseTo(0.9, 6);
    expect(marketMultiplier({ affinity: 0.3, popularity: 0.1 })).toBe(0.6);
    expect(suggestCapacity(city(0.8, 0.8), mid)).toBe(1500); // 1300 × 1.18 = 1534
    expect(suggestCapacity(city(0.9, 0.4), mid)).toBe(1100); // 1300 × 0.86 = 1118
    expect(suggestCapacity(city(0.3, 0.1), mid)).toBe(800); // 1300 × 0.6 = 780
  });

  it("prefers the city's saved quadrant over recomputing it", () => {
    expect(marketMultiplier({ affinity: 0.8, popularity: 0.5, quadrant: "reach" })).toBe(0.6);
    expect(marketMultiplier({ affinity: 0.8, popularity: 0.5 })).toBeCloseTo(0.82, 6); // untapped by quadrantOf
  });

  it("caps the room by metro size", () => {
    expect(metroCeiling(undefined)).toBe(2200);
    expect(metroCeiling(0.25)).toBe(1300);
    expect(suggestCapacity(city(1, 1, 0.25), stated("2000to5000"))).toBe(1300); // 3200 × 1.3 = 4160, capped
    expect(suggestCapacity(city(1, 1, 9), stated("2000to5000"))).toBe(4200); // ceiling 5800, not binding
  });

  it("never drifts below half the tier's floor", () => {
    expect(suggestCapacity(city(1, 1, 0.04), stated("2000to5000"))).toBe(1000); // ceiling 760, floor 2000 × 0.5
    expect(suggestCapacity(city(1, 1, 0.04), stated("over5000"))).toBe(2500);
    expect(suggestCapacity(city(0.3, 0.1), stated("under300"))).toBe(100); // 200 × 0.6 = 120
  });

  it("rounds to 50 under 1,000 and to 100 above", () => {
    expect(suggestCapacity(city(1, 1), stated("under300"))).toBe(250); // 260
    expect(suggestCapacity(city(1, 1), mid)).toBe(1700); // 1690
    for (const t of ["under300", "300to800", "800to2000", "2000to5000", "over5000"] as const) {
      const n = suggestCapacity(city(0.77, 0.61, 2.3), stated(t));
      expect(n % (n < 1000 ? 50 : 100)).toBe(0);
    }
  });

  it("states its basis, stated or guessed", () => {
    expect(capacityBasis(mid)).toBe("Anchored on the room tier 800 to 2,000 (stated in the brief) and moved by the city's affinity and popularity; a planning assumption, not a demand forecast");
    expect(capacityBasis({ tier: "300to800", guessed: true })).toContain("300 to 800 (guessed from Qloo popularity)");
  });

  it("staticEconomics resolves the room from the brief, or guesses it from act popularity", () => {
    const withTier = staticEconomics({ ...plan, input: { ...plan.input, roomTier: "300to800" } });
    expect(withTier.room).toEqual({ tier: "300to800", guessed: false });
    const s = plan.stops[0];
    expect(withTier.breakEven.get(s.order)!.capacity).toBe(suggestCapacity(s.city, withTier.room));
    const guessed = staticEconomics({ ...plan, input: { ...plan.input, roomTier: undefined } });
    expect(guessed.room).toEqual(resolveRoomTier({}, plan.act.popularity));
    expect(guessed.room.guessed).toBe(true);
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
