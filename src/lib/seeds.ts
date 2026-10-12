/**
 * The three seeded demos shown on the landing page. Real, well-known touring acts chosen for deep Qloo coverage and
 * for the judges' worlds (live music, stand-up, live podcast). In mock mode the names only label synthetic data.
 * Swap them on key day if Qloo coverage for any of them turns out thin.
 */
import type { PlanInput } from "@/lib/types";
import type { SEEDED_PLAN_IDS } from "@/lib/store";

export interface Seed {
  id: (typeof SEEDED_PLAN_IDS)[number];
  label: string;
  input: PlanInput;
}

export const SEEDS: Seed[] = [
  {
    id: "demo-musician",
    label: "Band, North America",
    input: {
      actQuery: "Khruangbin",
      actType: "artist",
      region: "north-america",
      stops: 10,
      window: "Jan–Mar 2027",
      lockedCities: [],
      excludedCities: [],
      budgetTier: "bus",
    },
  },
  {
    id: "demo-comedian",
    label: "Stand-up comedian, North America",
    input: {
      actQuery: "Nate Bargatze",
      actType: "person",
      region: "north-america",
      stops: 8,
      window: "Spring 2027",
      lockedCities: [],
      excludedCities: [],
      budgetTier: "bus",
    },
  },
  {
    id: "demo-podcast",
    label: "Live podcast, UK and Ireland",
    input: {
      actQuery: "The Rest Is History",
      actType: "podcast",
      region: "uk-ireland",
      stops: 6,
      window: "Feb 2027",
      lockedCities: [],
      excludedCities: [],
      budgetTier: "bus",
    },
  },
];

export function seedById(id: string): Seed | undefined {
  return SEEDS.find((s) => s.id === id);
}
