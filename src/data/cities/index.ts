/**
 * Curated candidate-city pools per region. Public geographic facts only: names, ISO-2 country codes,
 * approximate centroid coordinates, and approximate metro population in millions. No Qloo data lives here.
 */
import { z } from "zod";
import { CityPoolEntry, type Region } from "@/lib/types";
import na from "./na.json";
import ukIe from "./uk-ie.json";
import eu from "./eu.json";

const RAW: Record<Region, unknown> = {
  "north-america": na,
  "uk-ireland": ukIe,
  europe: eu,
};

const PoolSchema = z.array(CityPoolEntry);
const parsed = new Map<Region, CityPoolEntry[]>();

/** Returns the curated metro pool for a region (validated once, then memoized). */
export function getCityPool(region: Region): CityPoolEntry[] {
  const hit = parsed.get(region);
  if (hit) return hit;
  const pool = PoolSchema.parse(RAW[region]);
  parsed.set(region, pool);
  return pool;
}

/** Every pooled city across all regions, keyed by id. Handy for resolving locked/excluded city ids. */
export function findPooledCity(id: string): CityPoolEntry | undefined {
  for (const region of Object.keys(RAW) as Region[]) {
    const city = getCityPool(region).find((c) => c.id === id);
    if (city) return city;
  }
  return undefined;
}

export const CITY_POOL_REGIONS = Object.keys(RAW) as Region[];
