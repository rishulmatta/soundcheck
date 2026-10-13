import { describe, expect, it } from "vitest";
import { PlanInput, type CityPoolEntry } from "@/lib/types";
import { agentPrompt, withoutQlooPrompt, PLANNING_OBJECTIVE } from "./prompts";

describe("comparison prompt constraints", () => {
  it("gives both arms the same objective, candidate pool, and all planning constraints", () => {
    const input = PlanInput.parse({
      actQuery: "Test Act", actType: "podcast", region: "uk-ireland", stops: 3,
      window: "June 2027", budgetTier: "van", lockedCities: ["london"], excludedCities: ["leeds"],
      order: ["london", "bristol", "manchester"],
    });
    const pool: CityPoolEntry[] = [
      { id: "london", name: "London", country: "GB", lat: 51.5, lon: -0.1 },
      { id: "bristol", name: "Bristol", country: "GB", lat: 51.4, lon: -2.6 },
      { id: "manchester", name: "Manchester", country: "GB", lat: 53.5, lon: -2.2 },
      { id: "leeds", name: "Leeds", country: "GB", lat: 53.8, lon: -1.5 },
    ];
    const prompts = [agentPrompt(input, pool), withoutQlooPrompt(input, pool)];
    for (const prompt of prompts) {
      expect(prompt).toContain(PLANNING_OBJECTIVE);
      expect(prompt).toContain('Act: "Test Act" (type: podcast).');
      expect(prompt).toContain("Region: uk-ireland.");
      expect(prompt).toContain("Touring window: June 2027.");
      expect(prompt).toContain("Budget tier: van.");
      expect(prompt).toContain("Locked cities (must be on the tour): London.");
      expect(prompt).toContain("Excluded cities (must not be on the tour): Leeds.");
      expect(prompt).toContain("Requested city order: London → Bristol → Manchester.");
      expect(prompt).toContain("Select exactly 3 distinct cities");
      const candidates = prompt.split("\n").find((line) => line.startsWith("Candidate pool"));
      expect(candidates).toContain("london (London, GB)");
      expect(candidates).not.toContain("Leeds");
    }
    expect(prompts[1]).toContain(prompts[0]);
  });
});
