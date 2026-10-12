/**
 * Route economics. Soundcheck's own assumptions, never Qloo data.
 *
 * Promoters do not price hotels per city; they minimise dead days and drive length, and judge each show by break-even.
 * This module models exactly that and nothing more:
 * - leg distance from the routed stops (great-circle × a road factor), travel days from the route, crew days from both;
 * - a travel-and-crew estimate from a per-distance and a per-day rate that depend on the budget tier and stay editable;
 * - a break-even per stop from the suggested capacity and an assumed average ticket.
 * Legs longer than the tier's flight threshold are flagged as flight legs and left unpriced: there is no reliable free
 * source for flight or hotel prices and a made-up figure would be worse than none. Venue fees, production and the
 * act's guarantee are out of scope and the UI says so.
 */
import { haversineKm } from "@/lib/routing";
import type { BudgetTier, CityScore, PlanInput, Region, Stop } from "@/lib/types";

export interface Rates {
  /** Cost of moving the tour one distance unit: fuel, drivers, vehicle wear. */
  perUnit: number;
  /** Cost of one calendar day on the road: crew per diems, rooms, vehicle and backline rental. */
  perDay: number;
  /** Touring party size, for crew days. */
  crew: number;
  /** Assumed average ticket price for break-even. */
  avgTicket: number;
  /** Legs longer than this are flagged as flight legs and left unpriced. */
  flightLeg: number;
}

export interface Units {
  unit: "mi" | "km";
  currency: "USD" | "GBP" | "EUR";
}

export const BUDGET_TIER_LABEL: Record<BudgetTier, string> = {
  van: "Van and trailer",
  bus: "Bus and truck",
  production: "Full production",
};

export const BUDGET_TIER_HINT: Record<BudgetTier, string> = {
  van: "Act drives, 4 on the road, club rooms",
  bus: "One bus and one truck, 8 on the road",
  production: "Two buses, two trucks, 18 on the road",
};

/**
 * Soundcheck's default assumptions per tier, per mile in the region's currency. Rough on purpose; editable in the UI.
 * Flight thresholds follow what each rig can drive overnight: a van does a day's drive, a bus with a driver about 800
 * miles, trucks a little less.
 */
export const TIER_RATES: Record<BudgetTier, Rates> = {
  van: { perUnit: 0.9, perDay: 900, crew: 4, avgTicket: 30, flightLeg: 550 },
  bus: { perUnit: 2.4, perDay: 3200, crew: 8, avgTicket: 45, flightLeg: 800 },
  production: { perUnit: 4.8, perDay: 9000, crew: 18, avgTicket: 65, flightLeg: 750 },
};

/** Road distance runs about a quarter longer than the straight line. */
export const ROAD_FACTOR = 1.25;
const MI_PER_KM = 0.621371;

export function unitsFor(region: Region): Units {
  if (region === "uk-ireland") return { unit: "mi", currency: "GBP" };
  if (region === "europe") return { unit: "km", currency: "EUR" };
  return { unit: "mi", currency: "USD" };
}

/** The tier's defaults expressed in the plan's distance unit: per-km rate and km threshold for Europe. */
export function ratesFor(tier: BudgetTier, units: Units): Rates {
  const r = TIER_RATES[tier];
  if (units.unit === "mi") return { ...r };
  return { ...r, perUnit: Math.round((r.perUnit * MI_PER_KM) * 10) / 10, flightLeg: Math.round(r.flightLeg / MI_PER_KM / 50) * 50 };
}

/** Soundcheck's own venue-size heuristic (not a Qloo output): metro size scaled by affinity, local popularity and act popularity. */
export function suggestCapacity(city: Pick<CityScore, "metroM" | "affinity" | "popularity">, actPopularity = 0.5): number {
  const metro = city.metroM ?? 1;
  const base = 250 + 540 * Math.sqrt(metro);
  const raw = base * (0.4 + 0.6 * city.affinity) * (0.5 + 0.5 * city.popularity) * (0.5 + actPopularity);
  const clamped = Math.min(6000, Math.max(150, raw));
  return clamped < 1000 ? Math.round(clamped / 50) * 50 : Math.round(clamped / 100) * 100;
}

export interface Leg {
  /** Order of the stop this leg arrives at. */
  to: number;
  from: string;
  toName: string;
  /** Estimated road distance in the plan's unit. */
  distance: number;
  days: number;
  /** Longer than the tier's threshold: flagged, not priced. */
  flight: boolean;
  /** Distance cost plus the travel days' daily cost; 0 for a flight leg. */
  cost: number;
}

export interface RouteEconomics {
  legs: Leg[];
  totalDistance: number;
  travelDays: number;
  showDays: number;
  crewDays: number;
  /** Priced legs plus every show day's daily cost. Excludes flight legs. */
  travelCost: number;
  flightLegs: number;
  longestLeg?: Leg;
}

export function roadDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }, unit: Units["unit"]): number {
  const km = haversineKm(a, b) * ROAD_FACTOR;
  return Math.round(unit === "mi" ? km * MI_PER_KM : km);
}

export function routeEconomics(stops: Stop[], rates: Rates, unit: Units["unit"]): RouteEconomics {
  const legs: Leg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const s = stops[i];
    const distance = roadDistance(prev.city, s.city, unit);
    const flight = distance > rates.flightLeg;
    legs.push({
      to: s.order,
      from: prev.city.name,
      toName: s.city.name,
      distance,
      days: s.legDays,
      flight,
      cost: flight ? 0 : Math.round(distance * rates.perUnit + s.legDays * rates.perDay),
    });
  }
  const travelDays = legs.reduce((n, l) => n + l.days, 0);
  const showDays = stops.length;
  const legCost = legs.reduce((n, l) => n + l.cost, 0);
  return {
    legs,
    totalDistance: legs.reduce((n, l) => n + l.distance, 0),
    travelDays,
    showDays,
    crewDays: (travelDays + showDays) * rates.crew,
    travelCost: Math.round(legCost + showDays * rates.perDay),
    flightLegs: legs.filter((l) => l.flight).length,
    longestLeg: legs.length ? legs.reduce((a, b) => (b.distance > a.distance ? b : a)) : undefined,
  };
}

export interface BreakEven {
  capacity: number;
  /** Leg in plus one show day. Undefined when the leg in is a flight, since flights are not priced. */
  cost?: number;
  gross: number;
  /** Tickets that cover the cost. Undefined when cost is. */
  tickets?: number;
  /** tickets / capacity, 0..1 and beyond. */
  sellThrough?: number;
}

/** Travel-and-crew break-even for one stop: the leg that brings the tour in plus one show day, against the suggested room. */
export function stopBreakEven(stop: Stop, actPopularity: number | undefined, rates: Rates, leg: Leg | undefined): BreakEven {
  const capacity = suggestCapacity(stop.city, actPopularity ?? 0.5);
  const gross = capacity * rates.avgTicket;
  if (leg?.flight) return { capacity, gross };
  const cost = (leg?.cost ?? 0) + rates.perDay;
  const tickets = rates.avgTicket > 0 ? Math.ceil(cost / rates.avgTicket) : undefined;
  return { capacity, cost, gross, tickets, sellThrough: tickets !== undefined && capacity > 0 ? tickets / capacity : undefined };
}

export function formatMoney(n: number, currency: Units["currency"], digits = 0): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: Number.isInteger(n) ? 0 : digits, maximumFractionDigits: digits }).format(n);
}

export interface StaticEconomics {
  tier: BudgetTier;
  rates: Rates;
  units: Units;
  economics: RouteEconomics;
  /** Break-even per stop order. */
  breakEven: Map<number, BreakEven>;
}

/** The plan's tier at default rates, for server-rendered views (print) and anything else without editable state. */
export function staticEconomics(plan: { input: Pick<PlanInput, "budgetTier" | "region">; stops: Stop[]; act?: { popularity?: number } }): StaticEconomics {
  const tier = plan.input.budgetTier;
  const units = unitsFor(plan.input.region);
  const rates = ratesFor(tier, units);
  const economics = routeEconomics(plan.stops, rates, units.unit);
  const breakEven = new Map<number, BreakEven>();
  for (const s of plan.stops) breakEven.set(s.order, stopBreakEven(s, plan.act?.popularity, rates, economics.legs.find((l) => l.to === s.order)));
  return { tier, rates, units, economics, breakEven };
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
