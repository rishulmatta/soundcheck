import { z } from "zod";
import type { CityPoolEntry, PlanInput } from "@/lib/types";
import { matchesCity } from "@/lib/routing";

/** The comparison is a shortlist, not a booking or a prediction of sales. */
export const WithoutQloo = z.object({
  cities: z.array(z.string().trim().min(1)).min(1).max(20),
  openers: z.array(z.string().trim().min(1)).max(3),
  note: z.string().trim().min(1).max(600),
});
export type WithoutQloo = z.infer<typeof WithoutQloo>;

export type ComparisonValidation =
  | { ok: true; value: WithoutQloo }
  | { ok: false; reason: string };

/**
 * Fail closed instead of silently fixing the model's selection. Case/whitespace and city ids are canonicalized;
 * missing stops, invented cities, duplicates and broken constraints are never repaired to make a comparison pass.
 * Dates, budget feasibility and opener availability cannot be verified from this shortlist's output shape.
 */
export function validateWithoutQloo(candidate: unknown, input: PlanInput, pool: CityPoolEntry[]): ComparisonValidation {
  const parsed = WithoutQloo.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: "Comparison output was not a valid city shortlist." };
  const value = parsed.data;
  if (value.cities.length !== input.stops) {
    return { ok: false, reason: `Comparison returned ${value.cities.length} cities; the brief requested ${input.stops}.` };
  }

  const selected: CityPoolEntry[] = [];
  for (const name of value.cities) {
    const matches = pool.filter((city) => matchesCity(city, name));
    if (matches.length !== 1) return { ok: false, reason: "Comparison included a city outside the candidate pool or an ambiguous city name." };
    const city = matches[0];
    if (input.excludedCities.some((key) => matchesCity(city, key))) {
      return { ok: false, reason: `Comparison included excluded city ${city.name}.` };
    }
    if (selected.some((previous) => previous.id === city.id)) {
      return { ok: false, reason: `Comparison repeated city ${city.name}.` };
    }
    selected.push(city);
  }
  if (input.lockedCities.some((key) => !selected.some((city) => matchesCity(city, key)))) {
    return { ok: false, reason: "Comparison omitted a locked city." };
  }

  // Match the router's rule: a manual order only applies when it names exactly the selected cities.
  const order = input.order;
  if (order?.length === selected.length) {
    const ordered = order.map((key) => selected.find((city) => matchesCity(city, key)));
    const complete = ordered.every((city) => city !== undefined) && new Set(ordered.map((city) => city?.id)).size === selected.length;
    if (complete && ordered.some((city, index) => city?.id !== selected[index].id)) {
      return { ok: false, reason: "Comparison did not preserve the specified city order." };
    }
  }
  return { ok: true, value: { ...value, cities: selected.map((city) => city.name) } };
}

/** A saved comparison must not silently become a comparison against a different revision's brief. */
export function sameComparisonBrief(a: PlanInput, b: PlanInput): boolean {
  const normalize = (input: PlanInput) => ({
    actQuery: input.actQuery,
    actType: input.actType,
    actId: input.actId ?? null,
    region: input.region,
    stops: input.stops,
    window: input.window ?? null,
    budgetTier: input.budgetTier,
    roomTier: input.roomTier ?? null,
    lockedCities: input.lockedCities,
    excludedCities: input.excludedCities,
    order: input.order ?? null,
  });
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
