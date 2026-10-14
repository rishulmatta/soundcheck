/**
 * Small geographic helpers for assigning Qloo heatmap cells to pool cities. Pure, no Qloo data.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Cells within this distance of a city centroid count toward that city. Qloo returns geohash-4 cells (~39 x 20 km). */
export const CITY_CELL_RADIUS_KM = 40;

/** Equirectangular approximation; accurate to well under 1% at the distances used here. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = toRad(b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * WKT bounding polygon around a set of points with a margin, for `filter.location` on /v2/insights heatmaps.
 * One region-wide query returns cells normalized over the whole region, which is what makes cities comparable
 * (verified against the live API on 2026-10-14; per-city queries are each normalized to their own 0..1).
 * Bounds are snapped to whole degrees so the request (and its cache key) is stable while the pool is.
 */
export function regionPolygonWkt(points: LatLon[], marginDeg = 1): string {
  if (points.length === 0) throw new Error("regionPolygonWkt: no points");
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.floor(Math.min(...lats) - marginDeg);
  const maxLat = Math.ceil(Math.max(...lats) + marginDeg);
  const minLon = Math.floor(Math.min(...lons) - marginDeg);
  const maxLon = Math.ceil(Math.max(...lons) + marginDeg);
  return `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`;
}
