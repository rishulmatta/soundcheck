import type { ActType, Plan, Region, Stop } from "@/lib/types";

export const REGION_LABEL: Record<Region, string> = {
  "north-america": "North America",
  "uk-ireland": "UK + Ireland",
  europe: "Europe",
};

export const ACT_TYPE_LABEL: Record<ActType, string> = {
  artist: "Artist",
  person: "Comedian or creator",
  podcast: "Podcast",
  book: "Author",
  video_game: "Game",
  brand: "Brand",
};

export const ACT_TYPE_OPTION: Record<ActType, string> = {
  artist: "Musician or band",
  person: "Comedian or creator",
  podcast: "Live podcast",
  book: "Author",
  video_game: "Game",
  brand: "Brand",
};

export function totalLegDays(stops: Stop[]): number {
  return stops.reduce((n, s) => n + s.legDays, 0);
}

/** Deterministic date for server and client alike. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function planParams(plan: Pick<Plan, "input" | "stops">): string[] {
  const out: string[] = [REGION_LABEL[plan.input.region], `${plan.stops.length || plan.input.stops} stops`];
  if (plan.input.window) out.push(plan.input.window);
  return out;
}

/** Wrap "4.1×" style figures in a sentence in Data style. */
export function splitFigures(text: string): Array<{ text: string; figure: boolean }> {
  return text
    .split(/(\d+(?:\.\d+)?×)/g)
    .filter((t) => t !== "")
    .map((t) => ({ text: t, figure: /^\d+(?:\.\d+)?×$/.test(t) }));
}
