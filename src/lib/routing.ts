/**
 * Tour routing. Pure and deterministic.
 *
 * 1. Selection: locked cities are forced in (in the order given), excluded cities are removed, then the remaining
 *    slots are filled by `underserved` descending. If more cities are locked than `stops`, every locked city is kept.
 * 2. Ordering: nearest-neighbour over haversine distance, starting from the first locked city or, with no locks,
 *    the westernmost city; then a 2-opt pass over the open path with the start fixed.
 * 3. Travel days per leg: 1 for < 500 km, 2 for < 1500 km, else 3. The first stop has 0.
 *
 * Locked/excluded entries match a city by id or name, case-insensitively.
 */
import type { CityScore } from "@/lib/types";

export interface RouteOptions {
  stops: number;
  locked: string[];
  excluded: string[];
}

export interface RouteResult {
  order: CityScore[];
  /** Same length as order; legDays[0] is 0. */
  legDays: number[];
}

const EARTH_KM = 6371;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function legDaysFor(km: number): number {
  if (km < 500) return 1;
  if (km < 1500) return 2;
  return 3;
}

const norm = (s: string) => s.trim().toLowerCase();

export function matchesCity(city: { id: string; name: string }, key: string): boolean {
  const k = norm(key);
  return norm(city.id) === k || norm(city.name) === k;
}

function selectCities(cities: CityScore[], opts: RouteOptions): { picked: CityScore[]; start: CityScore | undefined } {
  const isExcluded = (c: CityScore) => opts.excluded.some((k) => matchesCity(c, k));
  const pool = cities.filter((c) => !isExcluded(c));
  const locked: CityScore[] = [];
  for (const key of opts.locked) {
    const hit = pool.find((c) => matchesCity(c, key));
    if (hit && !locked.includes(hit)) locked.push(hit);
  }
  const rest = pool
    .filter((c) => !locked.includes(c))
    .sort((a, b) => b.underserved - a.underserved || b.affinity - a.affinity || a.name.localeCompare(b.name));
  const slots = Math.max(0, opts.stops - locked.length);
  const picked = [...locked, ...rest.slice(0, slots)];
  const start = locked[0] ?? [...picked].sort((a, b) => a.lon - b.lon || a.name.localeCompare(b.name))[0];
  return { picked, start };
}

function nearestNeighbour(cities: CityScore[], start: CityScore): CityScore[] {
  const remaining = cities.filter((c) => c !== start);
  const path = [start];
  while (remaining.length) {
    const last = path[path.length - 1];
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (haversineKm(last, remaining[i]) < haversineKm(last, remaining[best])) best = i;
    }
    path.push(remaining.splice(best, 1)[0]);
  }
  return path;
}

export function pathKm(path: { lat: number; lon: number }[]): number {
  let km = 0;
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i]);
  return km;
}

/** 2-opt on an open path with index 0 fixed. Reverses segments while that shortens the path. */
function twoOpt(path: CityScore[]): CityScore[] {
  const p = [...path];
  const d = (i: number, j: number) => haversineKm(p[i], p[j]);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    for (let i = 1; i < p.length - 1; i++) {
      for (let k = i + 1; k < p.length; k++) {
        const before = d(i - 1, i) + (k + 1 < p.length ? d(k, k + 1) : 0);
        const after = d(i - 1, k) + (k + 1 < p.length ? d(i, k + 1) : 0);
        if (after + 1e-9 < before) {
          const seg = p.slice(i, k + 1).reverse();
          p.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
  }
  return p;
}

export function routeTour(cities: CityScore[], opts: RouteOptions): RouteResult {
  const { picked, start } = selectCities(cities, opts);
  if (!start || picked.length === 0) return { order: [], legDays: [] };
  const order = twoOpt(nearestNeighbour(picked, start));
  const legDays = order.map((c, i) => (i === 0 ? 0 : legDaysFor(haversineKm(order[i - 1], c))));
  return { order, legDays };
}
