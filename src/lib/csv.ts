/** CSV export of a plan: one row per stop. Pure; RFC 4180 quoting, CRLF line endings. */
import type { Plan, Stop } from "@/lib/types";

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
  "femaleShare",
  "openers",
  "sponsors",
  "places",
  "suggestion",
  "whyHere",
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

function stopRow(stop: Stop): Cell[] {
  const c = stop.city;
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
  ];
}

export function planToCsv(plan: Plan): string {
  const lines = [CSV_COLUMNS.join(","), ...plan.stops.map((s) => stopRow(s).map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}
