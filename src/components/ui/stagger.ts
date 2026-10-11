import type { CSSProperties } from "react";
import "./motion.css";

/** Style for `.sc-enter` / `.sc-dot` children: stagger by `step` ms, at most 12 staggered items, the rest arrive together. Server-safe. */
export function stagger(index: number, step = 40, base = 0): CSSProperties {
  return { ["--sc-delay" as string]: `${base + Math.min(index, 11) * step}ms` };
}
