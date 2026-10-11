/** Candidate city pools per region: the curated lists in src/data/cities (public geographic facts only). */
import { getCityPool } from "@/data/cities";
import type { CityPoolEntry, Region } from "@/lib/types";

export function cityPoolFor(region: Region): CityPoolEntry[] {
  return getCityPool(region);
}

/** Up to n items spread evenly across the list (pools are ordered roughly west to east, so this keeps geographic spread). */
export function spreadPick<T>(items: T[], n: number): T[] {
  if (n >= items.length) return [...items];
  if (n <= 0) return [];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]);
  return out;
}
