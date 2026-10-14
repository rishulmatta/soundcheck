import { describe, expect, it } from "vitest";
import { cityPoolFor } from "@/lib/agent/pool";
import { haversineKm, legDaysFor } from "@/lib/routing";
import {
  applyChanges,
  describeChanges,
  EMPTY_CHANGES,
  isEmptyChangeSet,
  isReorderOnly,
  mergeChanges,
  reorderStops,
  resolveCities,
  revisionNote,
} from "@/lib/revision";
import { PlanInput, type ChangeSet, type Stop } from "@/lib/types";

const pool = cityPoolFor("north-america");
const cityById = (id: string) => pool.find((c) => c.id === id)!;
const changes = (c: Partial<ChangeSet>): ChangeSet => ({ ...EMPTY_CHANGES, ...c });

function stop(id: string, order: number): Stop {
  const c = cityById(id);
  return {
    order,
    city: { ...c, affinity: 0.8, affinityRank: order, popularity: 0.4, underserved: 0.7, quadrant: "untapped", status: "ok" },
    legDays: order === 1 ? 0 : 9, // deliberately wrong so reorderStops has to recompute it
    demographics: { age: [], gender: { female: 0, male: 0 }, status: "empty" },
    openers: [],
    sponsors: [],
    places: [],
    suggestion: `${c.name} suggestion`,
    whyHere: `${c.name} why`,
  };
}

const route = ["seattle", "boise", "denver", "omaha", "chicago"];
const stops = route.map((id, i) => stop(id, i + 1));
const input = PlanInput.parse({
  actQuery: "The Example Band",
  stops: 5,
  lockedCities: ["Omaha", "seattle"],
  excludedCities: ["Tulsa"],
  order: route,
});
const plan = { input, stops };

describe("applyChanges", () => {
  it("returns the same constraints for an empty change-set", () => {
    expect(applyChanges(input, EMPTY_CHANGES, pool)).toEqual(input);
  });

  it("locks and drops by id, and unlocks a city that was locked by name", () => {
    const out = applyChanges(input, changes({ lock: ["austin"], unlock: ["omaha"], drop: ["chicago"] }), pool);
    expect(out.lockedCities).toEqual(["seattle", "austin"]);
    expect(out.excludedCities).toEqual(["Tulsa", "chicago"]);
  });

  it("dropping a locked city unlocks it; locking a dropped city restores it", () => {
    const dropLocked = applyChanges(input, changes({ drop: ["omaha"] }), pool);
    expect(dropLocked.lockedCities).toEqual(["seattle"]);
    expect(dropLocked.excludedCities).toContain("omaha");

    const lockDropped = applyChanges(input, changes({ lock: ["tulsa"] }), pool);
    expect(lockDropped.excludedCities).toEqual([]);
    expect(lockDropped.lockedCities).toContain("tulsa");
  });

  it("restore removes a city from the exclusions without locking it", () => {
    const out = applyChanges(input, changes({ restore: ["tulsa"] }), pool);
    expect(out.excludedCities).toEqual([]);
    expect(out.lockedCities).toEqual(input.lockedCities);
  });

  it("applies stops, window and budget tier", () => {
    const out = applyChanges(input, changes({ stops: 8, window: "Mar–Apr 2027", budgetTier: "van" }), pool);
    expect(out).toMatchObject({ stops: 8, window: "Mar–Apr 2027", budgetTier: "van" });
  });

  it("applies a room tier and keeps the parent's when the change-set has none", () => {
    expect(applyChanges(input, changes({ roomTier: "800to2000" }), pool).roomTier).toBe("800to2000");
    expect(applyChanges(input, EMPTY_CHANGES, pool).roomTier).toBeUndefined();
    const stated = { ...input, roomTier: "300to800" as const };
    expect(applyChanges(stated, changes({ stops: 6 }), pool).roomTier).toBe("300to800");
    expect(applyChanges(stated, changes({ roomTier: "under300" }), pool).roomTier).toBe("under300");
    // A room tier is not a city-set change: the manual order survives it.
    expect(applyChanges(input, changes({ roomTier: "over5000" }), pool).order).toEqual(route);
  });

  it("clears the manual order when the city set changes, keeps it otherwise", () => {
    expect(applyChanges(input, changes({ drop: ["boise"] }), pool).order).toBeUndefined();
    expect(applyChanges(input, changes({ restore: ["tulsa"] }), pool).order).toBeUndefined();
    expect(applyChanges(input, changes({ stops: 6 }), pool).order).toBeUndefined();
    expect(applyChanges(input, changes({ window: "Spring" }), pool).order).toEqual(route);
    expect(applyChanges(input, changes({ budgetTier: "production" }), pool).order).toEqual(route);
  });

  it("an explicit order replaces the previous one, and an empty order means none", () => {
    const reversed = [...route].reverse();
    expect(applyChanges(input, changes({ order: reversed }), pool).order).toEqual(reversed);
    expect(applyChanges(input, changes({ order: [] }), pool).order).toBeUndefined();
  });
});

describe("mergeChanges", () => {
  it("lets a later unlock / restore cancel an earlier lock / drop", () => {
    const m = mergeChanges(changes({ lock: ["austin"], drop: ["boise"] }), changes({ unlock: ["austin"], restore: ["boise"] }));
    expect(m.lock).toEqual([]);
    expect(m.unlock).toEqual(["austin"]);
    expect(m.drop).toEqual([]);
    expect(m.restore).toEqual(["boise"]);
  });

  it("lets a later lock / drop cancel an earlier unlock / restore", () => {
    const m = mergeChanges(changes({ unlock: ["omaha"], restore: ["tulsa"] }), changes({ lock: ["omaha"], drop: ["tulsa"] }));
    expect(m.lock).toEqual(["omaha"]);
    expect(m.unlock).toEqual([]);
    expect(m.drop).toEqual(["tulsa"]);
    expect(m.restore).toEqual([]);
  });

  it("accumulates distinct cities and lets later scalars win", () => {
    const m = mergeChanges(changes({ drop: ["boise"], stops: 8, window: "Spring" }), changes({ drop: ["denver", "boise"], stops: 6 }));
    expect(m.drop).toEqual(["boise", "denver"]);
    expect(m.stops).toBe(6);
    expect(m.window).toBe("Spring");
  });

  it("drops an earlier manual order once the later change-set changes the city set", () => {
    const order = [...route].reverse();
    expect(mergeChanges(changes({ order }), changes({ window: "Spring" })).order).toEqual(order);
    expect(mergeChanges(changes({ order }), changes({ drop: ["boise"] })).order).toBeUndefined();
    expect(mergeChanges(changes({ order }), changes({ order: route })).order).toEqual(route);
  });

  it("lets a later room tier win and keeps an earlier one otherwise", () => {
    expect(mergeChanges(changes({ roomTier: "300to800" }), changes({ roomTier: "800to2000" })).roomTier).toBe("800to2000");
    expect(mergeChanges(changes({ roomTier: "300to800" }), changes({ stops: 6 })).roomTier).toBe("300to800");
    expect(mergeChanges(EMPTY_CHANGES, changes({ roomTier: "over5000" })).roomTier).toBe("over5000");
  });

  it("merging empties stays empty", () => {
    expect(isEmptyChangeSet(mergeChanges(EMPTY_CHANGES, EMPTY_CHANGES))).toBe(true);
    expect(isEmptyChangeSet(changes({ window: "Spring" }))).toBe(false);
    expect(isEmptyChangeSet(changes({ roomTier: "under300" }))).toBe(false);
  });
});

describe("describeChanges / revisionNote", () => {
  it("names cities and lists each change once, in a stable order", () => {
    const lines = describeChanges(changes({ lock: ["austin"], drop: ["boise"], restore: ["tulsa"], unlock: ["omaha"] }), plan, pool);
    expect(lines.map((l) => l.text)).toEqual(["Drop Boise", "Allow Tulsa again", "Lock Austin", "Unlock Omaha"]);
    expect(revisionNote(lines)).toBe("Drop Boise · Allow Tulsa again · Lock Austin · Unlock Omaha");
  });

  it("describes scalar changes and skips ones equal to the current value", () => {
    const lines = describeChanges(changes({ stops: 8, window: "Mar 2027", budgetTier: "van" }), plan, pool);
    expect(lines.map((l) => l.text)).toEqual(["Stops 5 → 8", "Window unset → Mar 2027", "Budget bus → van"]);
    expect(describeChanges(changes({ stops: 5, budgetTier: "bus" }), plan, pool)).toEqual([]);
  });

  it("describes a room tier change from the stated tier, or from the guess", () => {
    const stated = { ...plan, input: { ...input, roomTier: "300to800" as const } };
    expect(describeChanges(changes({ roomTier: "800to2000" }), stated, pool)).toEqual([{ kind: "roomTier", text: "Room tier 300 to 800 → 800 to 2,000" }]);
    expect(describeChanges(changes({ roomTier: "300to800" }), stated, pool)).toEqual([]);
    expect(describeChanges(changes({ roomTier: "over5000" }), plan, pool)[0].text).toBe("Room tier guessed → Over 5,000");
  });

  it("summarises a reorder by the stops that moved", () => {
    const swapped = ["boise", "seattle", "denver", "omaha", "chicago"];
    expect(describeChanges(changes({ order: swapped }), plan, pool)[0].text).toBe("Route reordered: Boise, Seattle moved");
    const reversed = [...route].reverse();
    expect(describeChanges(changes({ order: reversed }), plan, pool)[0].text).toBe("Route reordered by hand (4 stops moved)");
    expect(describeChanges(changes({ order: route }), plan, pool)).toEqual([]);
  });

  it("caps the note at 300 characters", () => {
    const many = describeChanges(changes({ drop: pool.slice(0, 40).map((c) => c.id) }), plan, pool);
    expect(revisionNote(many).length).toBeLessThanOrEqual(300);
  });
});

describe("isReorderOnly", () => {
  const swapped = ["boise", "seattle", "denver", "omaha", "chicago"];
  it("is true for a permutation of the routed cities and nothing else", () => {
    expect(isReorderOnly(changes({ order: swapped }), plan)).toBe(true);
  });
  it("is false without an order, with any other change, or with a different city set", () => {
    expect(isReorderOnly(EMPTY_CHANGES, plan)).toBe(false);
    expect(isReorderOnly(changes({ order: swapped, lock: ["austin"] }), plan)).toBe(false);
    expect(isReorderOnly(changes({ order: swapped, window: "Spring" }), plan)).toBe(false);
    expect(isReorderOnly(changes({ order: swapped, budgetTier: "van" }), plan)).toBe(false);
    expect(isReorderOnly(changes({ order: swapped, roomTier: "800to2000" }), plan)).toBe(false);
    expect(isReorderOnly(changes({ order: swapped.slice(0, 4) }), plan)).toBe(false);
    expect(isReorderOnly(changes({ order: [...swapped.slice(0, 4), "austin"] }), plan)).toBe(false);
  });
});

describe("reorderStops", () => {
  it("renumbers and recomputes travel days from geography", () => {
    const order = ["chicago", "omaha", "denver", "boise", "seattle"];
    const out = reorderStops(stops, order);
    expect(out.map((s) => s.city.id)).toEqual(order);
    expect(out.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
    expect(out[0].legDays).toBe(0);
    for (let i = 1; i < out.length; i++) expect(out[i].legDays).toBe(legDaysFor(haversineKm(out[i - 1].city, out[i].city)));
    expect(out[0].whyHere).toBe("Chicago why");
    // Pure: the input stops are untouched.
    expect(stops.map((s) => s.city.id)).toEqual(route);
    expect(stops[1].legDays).toBe(9);
  });

  it("ignores unknown ids and keeps unlisted stops at the end in their order", () => {
    const out = reorderStops(stops, ["omaha", "atlantis", "boise"]);
    expect(out.map((s) => s.city.id)).toEqual(["omaha", "boise", "seattle", "denver", "chicago"]);
  });
});

describe("resolveCities", () => {
  it("matches by id, exact name, case-insensitive name and name prefix", () => {
    expect(resolveCities(["new-york", "Salt Lake City", "st. louis", "Minnea"], pool)).toEqual({
      ids: ["new-york", "salt-lake-city", "st-louis", "minneapolis"],
      unmatched: [],
    });
  });

  it("prefers an exact match over a prefix", () => {
    // "Portland" is exact; it must not resolve through a prefix to some other city.
    expect(resolveCities(["portland"], pool).ids).toEqual(["portland"]);
  });

  it("returns unmatched keys as typed (trimmed), skips blanks and de-duplicates hits", () => {
    expect(resolveCities(["  Atlantis ", "", "Boise", "boise"], pool)).toEqual({ ids: ["boise"], unmatched: ["Atlantis"] });
  });
});
