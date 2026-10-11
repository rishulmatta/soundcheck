import type { CSSProperties } from "react";
import { cn } from "./cn";

/** Placeholder block in `line` at the final element's size. Content replaces it in place; no spinner. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn("rounded-sm bg-line", className)} style={style} />;
}
