import { describe, expect, it } from "vitest";
import { PlanInput, type CityPoolEntry } from "@/lib/types";
import { agentPrompt, AGENT_INSTRUCTIONS, COPY_INSTRUCTIONS, REVISE_INSTRUCTIONS, SAFE_USE_RULES, revisePrompt, withoutQlooPrompt, PLANNING_OBJECTIVE } from "./prompts";

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
      expect(prompt).toContain("Current room size: not stated; Soundcheck guesses a tier from Qloo popularity");
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

describe("room tier", () => {
  const pool: CityPoolEntry[] = [
    { id: "london", name: "London", country: "GB", lat: 51.5, lon: -0.1 },
    { id: "bristol", name: "Bristol", country: "GB", lat: 51.4, lon: -2.6 },
    { id: "manchester", name: "Manchester", country: "GB", lat: 53.5, lon: -2.2 },
  ];
  const input = PlanInput.parse({ actQuery: "Test Act", region: "uk-ireland", stops: 3, roomTier: "800to2000" });

  it("states the room tier in the shared brief, for both comparison arms", () => {
    const line = "Current room size: 800 to 2,000 (stated in the brief). Room suggestions are anchored on it; Qloo does not know ticket draw.";
    expect(agentPrompt(input, pool)).toContain(line);
    expect(withoutQlooPrompt(input, pool)).toContain(line);
  });

  it("asks copy to name the anchor tier and flag a guessed one", () => {
    expect(COPY_INSTRUCTIONS).toContain("soundcheck.roomTier");
    expect(COPY_INSTRUCTIONS).toContain("soundcheck.roomTierGuessed");
    expect(COPY_INSTRUCTIONS).toContain("anchored on the stated 800 to 2,000 tier");
  });

  it("offers roomTier as a revise control with every value and label, and shows the current one", () => {
    expect(REVISE_INSTRUCTIONS).toContain("roomTier:");
    for (const v of ["under300 (Under 300)", "300to800 (300 to 800)", "800to2000 (800 to 2,000)", "2000to5000 (2,000 to 5,000)", "over5000 (Over 5,000)"]) {
      expect(REVISE_INSTRUCTIONS).toContain(v);
    }
    const plan = { input, act: { id: "a", name: "Test Act", type: "artist" as const, tasteTags: [], links: [], popularity: 0.95 }, stops: [] };
    expect(revisePrompt(plan, pool, "bigger rooms")).toContain("roomTier 800to2000 = 800 to 2,000 (stated in the brief);");
    const guessed = { ...plan, input: { ...input, roomTier: undefined } };
    expect(revisePrompt(guessed, pool, "bigger rooms")).toContain("roomTier 300to800 = 300 to 800 (guessed from Qloo popularity);");
  });
});

describe("heatmap comparability wording", () => {
  it("states the region-wide heatmap scope in the safe-use rules without the old blanket caveat", () => {
    expect(SAFE_USE_RULES).not.toContain("Cross-city heatmap comparability is unverified");
    expect(SAFE_USE_RULES).toContain("one region-wide Qloo heatmap query");
    expect(SAFE_USE_RULES).toMatch(/not ticket demand, booking history or venue availability/);
  });

  it("tells the agent to probe the pool once and keeps the thin-city re-seed", () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/probeCities once with seed "act", passing the whole candidate pool/);
    expect(AGENT_INSTRUCTIONS).toContain('probeCities again for those cities with seed "tags"');
    expect(AGENT_INSTRUCTIONS).toContain("affinity exceeds popularity by at least 0.02");
    expect(AGENT_INSTRUCTIONS).toContain("no movement in Qloo's series");
    expect(AGENT_INSTRUCTIONS).not.toMatch(/weeks/);
  });

  it("switches the whyHere source rule on facts.qloo.heatmapComparability", () => {
    expect(COPY_INSTRUCTIONS).toContain("facts.qloo.heatmapComparability");
    expect(COPY_INSTRUCTIONS).toMatch(/"region-normalized":[^\n]*region-wide[^\n]*Do not call the comparison unverified/);
    expect(COPY_INSTRUCTIONS).toMatch(/"unverified": every sentence must include "unverified"/);
  });
});
