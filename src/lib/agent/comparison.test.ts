import { describe, expect, it } from "vitest";
import { PlanInput, type CityPoolEntry } from "@/lib/types";
import { sameComparisonBrief, validateWithoutQloo } from "./comparison";

const pool: CityPoolEntry[] = [
  { id: "london", name: "London", country: "GB", lat: 51.5, lon: -0.1 },
  { id: "bristol", name: "Bristol", country: "GB", lat: 51.4, lon: -2.6 },
  { id: "manchester", name: "Manchester", country: "GB", lat: 53.5, lon: -2.2 },
  { id: "leeds", name: "Leeds", country: "GB", lat: 53.8, lon: -1.5 },
];
const input = PlanInput.parse({ actQuery: "Test Act", region: "uk-ireland", stops: 3, lockedCities: ["london"], excludedCities: ["leeds"] });
const draft = { cities: ["London", "Bristol", "Manchester"], openers: [], note: "A regional shortlist to investigate; availability is unverified." };

describe("validateWithoutQloo", () => {
  it("canonicalizes harmless naming differences without changing the selected route", () => {
    const result = validateWithoutQloo({ ...draft, cities: [" london ", "BRISTOL", "manchester"] }, input, pool);
    expect(result).toEqual({ ok: true, value: draft });
  });

  it.each([
    ["too few stops", ["London", "Bristol"], /requested 3/],
    ["duplicate city", ["London", "Bristol", "bristol"], /repeated/],
    ["invented city", ["London", "Bristol", "Paris"], /outside the candidate pool/],
    ["excluded city", ["London", "Bristol", "Leeds"], /excluded city Leeds/],
  ])("rejects %s rather than silently repairing the comparison", (_case, cities, reason) => {
    expect(validateWithoutQloo({ ...draft, cities }, input, pool)).toEqual({ ok: false, reason: expect.stringMatching(reason) });
  });

  it("rejects a missing locked city, including a lock specified by name", () => {
    expect(validateWithoutQloo({ ...draft, cities: ["Bristol", "Manchester", "Leeds"] }, { ...input, lockedCities: ["London"], excludedCities: [] }, pool))
      .toEqual({ ok: false, reason: expect.stringMatching(/locked city/) });
  });

  it("rejects malformed structured output", () => {
    expect(validateWithoutQloo({ cities: draft.cities, openers: [null] }, input, pool).ok).toBe(false);
  });

  it("respects a complete manual order but leaves an inapplicable order to the router rule", () => {
    expect(validateWithoutQloo(draft, { ...input, order: ["manchester", "bristol", "london"] }, pool))
      .toEqual({ ok: false, reason: expect.stringMatching(/specified city order/) });
    expect(validateWithoutQloo(draft, { ...input, order: ["leeds", "bristol", "london"] }, pool).ok).toBe(true);
  });

  it("rejects ambiguous names instead of selecting an arbitrary match", () => {
    const ambiguous = [...pool, { ...pool[0], id: "other-london" }];
    expect(validateWithoutQloo(draft, input, ambiguous).ok).toBe(false);
  });
});

describe("sameComparisonBrief", () => {
  it("accepts an unchanged brief and ignores object property order", () => {
    expect(sameComparisonBrief(input, { ...input })).toBe(true);
  });

  it.each([
    { budgetTier: "van" as const },
    { window: "June 2027" },
    { stops: 4 },
    { region: "europe" as const },
    { actQuery: "Another Act" },
    { actType: "podcast" as const },
    { actId: "another-entity" },
    { lockedCities: ["bristol"] },
    { excludedCities: [] },
    { order: ["london", "bristol", "manchester"] },
  ])("invalidates a saved comparison when a brief field changes: %j", (change) => {
    expect(sameComparisonBrief(input, { ...input, ...change })).toBe(false);
  });
});
