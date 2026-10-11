import type { CSSProperties } from "react";
import { cn } from "./cn";

/**
 * The numbered stop disc: spot fill, on-spot mono numeral. Shared by the plan UI and the map markers.
 * `ring` draws the 2px bg-sunken edge used on the map; `selected` adds the glow.
 */
export function StopMarker({ n, size = 26, selected = false, ring = false, className, style }: { n: number; size?: number; selected?: boolean; ring?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-spot font-mono font-medium leading-none text-on-spot transition-shadow duration-150",
        ring && "border-2 border-bg-sunken",
        selected && "shadow-glow",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), ...style }}
    >
      {n}
    </span>
  );
}
