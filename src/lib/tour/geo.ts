/**
 * Small geometry helpers for the tour route. No turf dependency: haversine, a line slicer
 * and a great-circle interpolator are all the map needs.
 */

/** [longitude, latitude] in degrees, GeoJSON order. */
export type LngLat = [number, number];

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance between two points in kilometres. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length of a polyline in kilometres. */
export function lineLengthKm(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineKm(coords[i - 1], coords[i]);
  return total;
}

/** Linear interpolation in lon/lat. Good enough for a single short segment. */
export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The part of a polyline between startKm and stopKm measured along it (turf's lineSliceAlong).
 * Distances are clamped to the line; the cut points are interpolated on the segment they fall in.
 */
export function lineSliceAlong(coords: LngLat[], startKm: number, stopKm: number): LngLat[] {
  if (coords.length === 0) return [];
  const total = lineLengthKm(coords);
  const from = Math.max(0, Math.min(startKm, stopKm));
  const to = Math.min(total, Math.max(startKm, stopKm));
  if (to <= from) return [lerpAtDistance(coords, from, total)];

  const out: LngLat[] = [lerpAtDistance(coords, from, total)];
  let travelled = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineKm(coords[i - 1], coords[i]);
    const end = travelled + seg;
    if (end > from && end < to) out.push(coords[i]);
    travelled = end;
    if (travelled >= to) break;
  }
  out.push(lerpAtDistance(coords, to, total));
  return out;
}

function lerpAtDistance(coords: LngLat[], km: number, total: number): LngLat {
  if (km <= 0) return coords[0];
  if (km >= total) return coords[coords.length - 1];
  let travelled = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineKm(coords[i - 1], coords[i]);
    if (travelled + seg >= km) {
      return seg === 0 ? coords[i] : lerpLngLat(coords[i - 1], coords[i], (km - travelled) / seg);
    }
    travelled += seg;
  }
  return coords[coords.length - 1];
}

/** Points along the great circle from a to b, inclusive, `segments + 1` points. */
export function greatCircle(a: LngLat, b: LngLat, segments = 48): LngLat[] {
  const lat1 = toRad(a[1]);
  const lon1 = toRad(a[0]);
  const lat2 = toRad(b[1]);
  const lon2 = toRad(b[0]);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (d < 1e-9) return [a, b];
  const out: LngLat[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  // Pin the ends exactly so legs join without float drift.
  out[0] = a;
  out[out.length - 1] = b;
  return out;
}

/** One polyline per leg: legs[i] runs from points[i] to points[i + 1]. */
export function buildLegs(points: LngLat[], segments = 48): LngLat[][] {
  const legs: LngLat[][] = [];
  for (let i = 1; i < points.length; i++) legs.push(greatCircle(points[i - 1], points[i], segments));
  return legs;
}

/**
 * The route as drawn when the tour is on stop `order` (1-based) and its incoming leg is `t` (0..1) drawn.
 * Stop 1 has no incoming leg, so nothing is drawn. Legs before it are complete.
 */
export function routeProgress(legs: LngLat[][], order: number, t: number): LngLat[] {
  if (order <= 1 || legs.length === 0) return [];
  const upTo = Math.min(order - 1, legs.length); // number of legs involved
  const coords: LngLat[] = [];
  for (let i = 0; i < upTo - 1; i++) appendLine(coords, legs[i]);
  const last = legs[upTo - 1];
  const f = Math.max(0, Math.min(1, t));
  if (f >= 1) appendLine(coords, last);
  else if (f > 0) appendLine(coords, lineSliceAlong(last, 0, lineLengthKm(last) * f));
  else if (coords.length === 0) coords.push(last[0]);
  return coords;
}

/** The tip of the route at (order, t), used for the moving "pen" dot while a leg draws. */
export function routeHead(legs: LngLat[][], order: number, t: number): LngLat | null {
  if (order <= 1 || legs.length === 0) return null;
  const leg = legs[Math.min(order - 1, legs.length) - 1];
  const slice = lineSliceAlong(leg, 0, lineLengthKm(leg) * Math.max(0, Math.min(1, t)));
  return slice[slice.length - 1] ?? null;
}

function appendLine(target: LngLat[], line: LngLat[]) {
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const prev = target[target.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    target.push(p);
  }
}

/** [west, south, east, north] */
export type Bbox = [number, number, number, number];

export function bboxOf(points: LngLat[]): Bbox | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}
