import type { ToolStatus } from "@/lib/types";
import { StatusChip } from "./StatusChip";
import { cn } from "./cn";

/** Muted band shown instead of an empty section when Qloo data is thin. Says it plainly, once. */
export function LimitedData({ status = "partial", children, className }: { status?: ToolStatus; children: React.ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-sm bg-warn-soft px-3 py-2", className)}>
      <StatusChip status={status === "ok" ? "partial" : status} size="sm" className="mt-px shrink-0" />
      <p className="text-[13px] leading-[18px] text-ink">{children}</p>
    </div>
  );
}
