/** CSV export of a plan: one row per stop. Pure; RFC 4180 quoting, CRLF line endings. */
import type { Plan, Stop } from "@/lib/types";
import { capacityBasis, ratesFor, routeEconomics, stopBreakEven, unitsFor, type Leg, type Rates } from "@/lib/economics";
import { resolveRoomTier, type ResolvedRoomTier } from "@/lib/room";
import { provenanceFor, safePlanForDisplay } from "@/lib/provenance";

export const CSV_COLUMNS = [
  "order",
  "city",
  "country",
  "lat",
  "lon",
  "affinity",
  "affinityRank",
  "popularity",
  "underserved",
  "quadrant",
  "legDays",
  "topAgeBucket",
  "femaleScore",
  "openers",
  "sponsors",
  "places",
  "suggestion",
  "whyHere",
  "legDistance",
  "distanceUnit",
  "legFlight",
  "legCostEst",
  "currency",
  "suggestedCapacity",
  "breakEvenTickets",
  "dataMode",
  "heatmapComparability",
  "demographicsScope",
  "scoringMethod",
  "capacityBasis",
  "ticketsBasis",
] as const;

type Cell = string | number | null | undefined;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  // Neutralise spreadsheet formula injection from free-text fields (names come from a third-party API).
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function topAgeBucket(stop: Stop): string {
  const best = [...stop.demographics.age].sort((a, b) => b.score - a.score)[0];
  return best?.bucket ?? "";
}

interface Econ {
  unit: string;
  currency: string;
  rates: Rates;
  room: ResolvedRoomTier;
  legs: Leg[];
}

function stopRow(stop: Stop, e: Econ): Cell[] {
  const c = stop.city;
  const leg = e.legs.find((l) => l.to === stop.order);
  const b = stopBreakEven(stop, e.room, e.rates, leg);
  return [
    stop.order,
    c.name,
    c.country,
    c.lat,
    c.lon,
    c.affinity,
    c.affinityRank,
    c.popularity,
    c.underserved,
    c.quadrant,
    stop.legDays,
    topAgeBucket(stop),
    stop.demographics.gender.female,
    stop.openers.map((p) => p.name).join(" | "),
    stop.sponsors.map((p) => p.name).join(" | "),
    stop.places.map((p) => p.name).join(" | "),
    stop.suggestion,
    stop.whyHere,
    leg?.distance ?? 0,
    e.unit,
    leg ? (leg.flight ? "yes" : "no") : "",
    leg && !leg.flight ? leg.cost : "",
    e.currency,
    b.capacity,
    b.tickets ?? "",
  ];
}

/** Economics columns use the plan's budget tier at Soundcheck's default rates (the UI lets the user edit them; the CSV does not). */
export function planToCsv(plan: Plan): string {
  plan = safePlanForDisplay(plan);
  const provenance = provenanceFor(plan);
  const units = unitsFor(plan.input.region);
  const rates = ratesFor(plan.input.budgetTier, units);
  const room = resolveRoomTier(plan.input, plan.act.popularity);
  const econ: Econ = { ...units, rates, room, legs: routeEconomics(plan.stops, rates, units.unit).legs };
  const notes: Cell[] = [
    provenance.dataMode, provenance.heatmapComparability, provenance.demographicsScope, provenance.scoringMethod,
    capacityBasis(room),
    "Tickets to cover modeled travel and crew costs only; not full show break-even",
  ];
  const lines = [CSV_COLUMNS.join(","), ...plan.stops.map((s) => [...stopRow(s, econ), ...notes].map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}
