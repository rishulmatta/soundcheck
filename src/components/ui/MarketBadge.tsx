import type { Quadrant } from "@/lib/types";
import { cn } from "./cn";

const tone: Record<Quadrant, string> = {
  untapped: "text-signal bg-signal-soft",
  established: "text-ink-muted",
  reach: "text-ink-faint",
};
const label: Record<Quadrant, string> = { untapped: "Investigate", established: "Higher signals", reach: "Lower affinity" };

export function MarketBadge({ quadrant, size = "md", className }: { quadrant: Quadrant; size?: "md" | "sm"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-current font-semibold uppercase tracking-[0.08em] whitespace-nowrap",
        size === "md" ? "h-[22px] px-2.5 text-[11px] leading-4" : "h-[18px] px-2 text-[10px] leading-4",
        tone[quadrant],
        className,
      )}
    >
      {label[quadrant]}
    </span>
  );
}
