/**
 * Room size anchor. Qloo popularity is a percentile of cultural presence, compressed near the top (every act run so
 * far sits between 0.82 and 0.99), so it cannot tell a 300-cap act from a 3,000-cap act. The manager can, so the
 * brief carries the room tier the act plays today; Qloo's city signals only move each stop up or down from it.
 * When the brief leaves it blank, the tier is guessed from popularity and labeled as a guess everywhere it shows.
 */
import type { PlanInput, RoomTier } from "./types";

export interface RoomTierInfo {
  label: string;
  /** Typical capacity the tier anchors on. */
  anchor: number;
  min: number;
  max: number;
  /** How far below the headliner's Qloo popularity an opener should sit; small rooms need clearly smaller openers. */
  openerGap: number;
}

export const ROOM_TIERS: Record<RoomTier, RoomTierInfo> = {
  under300: { label: "Under 300", anchor: 200, min: 100, max: 300, openerGap: 0.08 },
  "300to800": { label: "300 to 800", anchor: 500, min: 300, max: 800, openerGap: 0.06 },
  "800to2000": { label: "800 to 2,000", anchor: 1300, min: 800, max: 2000, openerGap: 0.04 },
  "2000to5000": { label: "2,000 to 5,000", anchor: 3200, min: 2000, max: 5000, openerGap: 0.03 },
  over5000: { label: "Over 5,000", anchor: 7000, min: 5000, max: 15000, openerGap: 0.02 },
};

export const ROOM_TIER_ORDER: RoomTier[] = ["under300", "300to800", "800to2000", "2000to5000", "over5000"];

/** A guess from Qloo popularity, for a brief that states no room tier. Coarse on purpose; see the file comment. */
export function guessRoomTier(actPopularity: number | undefined): RoomTier {
  const p = actPopularity ?? 0.5;
  if (p >= 0.99) return "2000to5000";
  if (p >= 0.97) return "800to2000";
  if (p >= 0.9) return "300to800";
  return "under300";
}

export interface ResolvedRoomTier {
  tier: RoomTier;
  /** True when the brief stated no tier and this one was guessed from Qloo popularity. */
  guessed: boolean;
}

export function resolveRoomTier(input: Pick<PlanInput, "roomTier">, actPopularity: number | undefined): ResolvedRoomTier {
  return input.roomTier ? { tier: input.roomTier, guessed: false } : { tier: guessRoomTier(actPopularity), guessed: true };
}

/** "800 to 2,000 (stated)" or "300 to 800 (guessed from Qloo popularity)". */
export function describeRoomTier(r: ResolvedRoomTier): string {
  return `${ROOM_TIERS[r.tier].label}${r.guessed ? " (guessed from Qloo popularity)" : " (stated in the brief)"}`;
}

export interface PopularityBand {
  min: number;
  max: number;
}

/**
 * Opener popularity band: below the headliner by the tier's gap, with a floor so the opener still has a presence.
 * Qloo popularity is a percentile, so a 0.04 gap near the top is a large drop in cultural presence. Verified live
 * 2026-10-14: a 0.95 ceiling on a 0.99 headliner returned support-sized acts instead of fellow headliners.
 */
export function openerPopularityBand(actPopularity: number | undefined, tier: RoomTier): PopularityBand {
  const p = actPopularity ?? 0.9;
  const max = Math.max(0.2, Math.min(0.97, p - ROOM_TIERS[tier].openerGap));
  const min = Math.max(0, max - 0.3);
  return { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 };
}
