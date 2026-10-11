import type { Demographics } from "@/lib/types";

/** "24_and_younger" -> "≤24", "25_to_29" -> "25–29", "55_and_older" -> "55+". */
export function bucketLabel(bucket: string): string {
  const younger = bucket.match(/^(\d+)_and_younger$/);
  if (younger) return `≤${younger[1]}`;
  const older = bucket.match(/^(\d+)_and_older$/);
  if (older) return `${older[1]}+`;
  const range = bucket.match(/^(\d+)_to_(\d+)$/);
  if (range) return `${range[1]}–${range[2]}`;
  return bucket.replace(/_/g, " ");
}

/** The age bucket that over-indexes most, or null when Qloo returned none. */
export function strongestBucket(d: Demographics): { label: string; score: number } | null {
  if (d.age.length === 0) return null;
  const top = d.age.reduce((a, b) => (b.score > a.score ? b : a));
  return { label: bucketLabel(top.bucket), score: top.score };
}

export function genderSkew(d: Demographics): string {
  const diff = d.gender.female - d.gender.male;
  if (diff >= 0.04) return "skews female";
  if (diff <= -0.04) return "skews male";
  return "evenly split";
}

/** Split "4.1×" style figures so they can be set in Data style. */
export function splitFigures(text: string): Array<{ text: string; figure: boolean }> {
  return text
    .split(/(\d+(?:\.\d+)?×)/g)
    .filter((t) => t !== "")
    .map((t) => ({ text: t, figure: /^\d+(?:\.\d+)?×$/.test(t) }));
}
