import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { cn } from "@/components/ui/cn";

export const DATA_MODE_LABEL = {
  mock: "Synthetic example",
  live: "Qloo API mode",
  unknown: "Source unverified",
} as const;

const DETAIL = {
  mock: "Signals are simulated. Explore the workflow, then regenerate with live data before making decisions.",
  live: "Some Qloo requests returned data. Check the trace for gaps; recommendations remain Soundcheck’s interpretation.",
  unknown: "This saved plan has no confirmed data source. Regenerate it to establish its evidence.",
} as const;

export function ProvenanceBanner({ plan, className }: { plan: Plan; className?: string }) {
  const { dataMode, heatmapComparability } = provenanceFor(plan);
  const hasReturnedData = plan.trace.some((step) => step.calls.some((call) => call.status === "ok" || call.status === "partial"));
  const detail = dataMode === "live" && !hasReturnedData
    ? "No successful Qloo requests were recorded. This plan has no confirmed Qloo support; inspect the trace and retry before using its recommendations."
    : DETAIL[dataMode];
  return (
    <aside aria-label="Plan evidence" className={cn("rounded-md border border-line-strong bg-bg-raised px-4 py-3 text-[13px] leading-[18px]", className)}>
      <p className="font-semibold text-ink">{DATA_MODE_LABEL[dataMode]}</p>
      <p className="mt-1 text-ink-muted">{detail}</p>
      <p className="mt-1 text-ink-muted">
        {heatmapComparability === "region-normalized"
          ? "Cities are scored from one region-wide Qloo heatmap, so their affinity and popularity are comparable within this plan. Popularity does not establish booking history."
          : "City comparisons are provisional: cross-city score comparability is unverified. Popularity does not establish booking history."}
      </p>
    </aside>
  );
}
