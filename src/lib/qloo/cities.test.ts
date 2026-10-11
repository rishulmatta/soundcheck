import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CityPoolEntry, Region } from "@/lib/types";
import { getCityPool } from "@/data/cities";
import na from "@/data/cities/na.json";
import ukIe from "@/data/cities/uk-ie.json";
import eu from "@/data/cities/eu.json";

describe("city pools", () => {
  it.each([
    ["na.json", na, 35, 45],
    ["uk-ie.json", ukIe, 12, 20],
    ["eu.json", eu, 20, 30],
  ])("%s parses as CityPoolEntry[] with a sensible size", (_name, raw, min, max) => {
    const parsed = z.array(CityPoolEntry).safeParse(raw);
    expect(parsed.success).toBe(true);
    const pool = parsed.data ?? [];
    expect(pool.length).toBeGreaterThanOrEqual(min);
    expect(pool.length).toBeLessThanOrEqual(max);
    for (const c of pool) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.country).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect(c.metroM).toBeGreaterThan(0);
    }
  });

  it("has unique ids across all regions and includes the untapped-style markets", () => {
    const all = Region.options.flatMap((r) => getCityPool(r));
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    const naIds = new Set(getCityPool("north-america").map((c) => c.id));
    for (const id of ["boise", "omaha", "tulsa", "spokane", "madison", "halifax"]) expect(naIds.has(id)).toBe(true);
  });

  it("keeps countries within their region", () => {
    expect(new Set(getCityPool("north-america").map((c) => c.country))).toEqual(new Set(["US", "CA"]));
    expect(new Set(getCityPool("uk-ireland").map((c) => c.country))).toEqual(new Set(["GB", "IE"]));
  });
});
