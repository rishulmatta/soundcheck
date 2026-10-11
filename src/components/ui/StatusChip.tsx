import type { ReactNode } from "react";
import type { ToolStatus } from "@/lib/types";
import { cn } from "./cn";

const tone: Record<ToolStatus, string> = {
  ok: "text-ok bg-ok-soft",
  empty: "text-ink-muted bg-bg-sunken",
  partial: "text-warn bg-warn-soft",
  degraded: "text-warn bg-warn-soft",
  error: "text-danger bg-danger-soft",
};

/** A status hue always sits beside its word. */
export function StatusChip({ status, children, size = "md", className }: { status: ToolStatus; children?: ReactNode; size?: "md" | "sm"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-mono font-medium leading-4",
        size === "md" ? "h-[22px] px-2.5 text-xs" : "h-[18px] px-2 text-[11px]",
        tone[status],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children ?? status}
    </span>
  );
}
