import { describe, expect, it } from "vitest";
import { ROOM_TIERS, ROOM_TIER_ORDER, describeRoomTier, guessRoomTier, openerPopularityBand, resolveRoomTier } from "./room";

describe("room tiers", () => {
  it("orders tiers by anchor and keeps anchors inside their bounds", () => {
    const anchors = ROOM_TIER_ORDER.map((t) => ROOM_TIERS[t].anchor);
    expect([...anchors].sort((a, b) => a - b)).toEqual(anchors);
    for (const t of ROOM_TIER_ORDER) expect(ROOM_TIERS[t].anchor).toBeGreaterThanOrEqual(ROOM_TIERS[t].min);
    for (const t of ROOM_TIER_ORDER) expect(ROOM_TIERS[t].anchor).toBeLessThanOrEqual(ROOM_TIERS[t].max);
  });

  it("guesses coarsely from popularity and says so", () => {
    expect(guessRoomTier(0.995)).toBe("2000to5000");
    expect(guessRoomTier(0.97)).toBe("800to2000");
    expect(guessRoomTier(0.91)).toBe("300to800");
    expect(guessRoomTier(0.5)).toBe("under300");
    expect(guessRoomTier(undefined)).toBe("under300");
    const guessed = resolveRoomTier({}, 0.97);
    expect(guessed).toEqual({ tier: "800to2000", guessed: true });
    expect(describeRoomTier(guessed)).toBe("800 to 2,000 (guessed from Qloo popularity)");
  });

  it("prefers the tier stated in the brief", () => {
    const stated = resolveRoomTier({ roomTier: "under300" }, 0.99);
    expect(stated).toEqual({ tier: "under300", guessed: false });
    expect(describeRoomTier(stated)).toBe("Under 300 (stated in the brief)");
  });
});

describe("openerPopularityBand", () => {
  it("sits below the headliner by the tier's gap, with a floor", () => {
    expect(openerPopularityBand(0.99, "2000to5000")).toEqual({ min: 0.66, max: 0.96 });
    expect(openerPopularityBand(0.99, "under300")).toEqual({ min: 0.61, max: 0.91 });
    expect(openerPopularityBand(0.96, "800to2000")).toEqual({ min: 0.62, max: 0.92 });
  });

  it("never exceeds 0.97 and never drops the ceiling below 0.2", () => {
    expect(openerPopularityBand(1, "over5000").max).toBe(0.97);
    expect(openerPopularityBand(0.1, "under300")).toEqual({ min: 0, max: 0.2 });
    expect(openerPopularityBand(undefined, "300to800")).toEqual({ min: 0.54, max: 0.84 });
  });
});
