/**
 * The three seeded demos shown on the landing page. Act names are placeholders until key day,
 * when they are swapped for real acts with deep Qloo coverage (see docs/STATUS.md open questions).
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
    label: "Indie band, North America",
    input: {
      actQuery: "The Example Band",
      actType: "artist",
      region: "north-america",
      stops: 10,
      window: "Jan–Mar 2027",
      lockedCities: [],
      excludedCities: [],
    },
  },
  {
    id: "demo-comedian",
    label: "Stand-up comedian, North America",
    input: {
      actQuery: "Example Comedian",
      actType: "person",
      region: "north-america",
      stops: 8,
      window: "Spring 2027",
      lockedCities: [],
      excludedCities: [],
    },
  },
  {
    id: "demo-podcast",
    label: "Live podcast, UK and Ireland",
    input: {
      actQuery: "The Example Podcast",
      actType: "podcast",
      region: "uk-ireland",
      stops: 6,
      window: "Feb 2027",
      lockedCities: [],
      excludedCities: [],
    },
  },
];

export function seedById(id: string): Seed | undefined {
  return SEEDS.find((s) => s.id === id);
}
