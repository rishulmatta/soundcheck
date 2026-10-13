import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { DATA_MODE_LABEL } from "./ProvenanceBanner";
import { formatDate } from "./format";

/** Part of the layout on every plan, not a legal footnote. */
export function ProvenanceFooter({ plan, className }: { plan: Plan; className?: string }) {
  const date = formatDate(plan.createdAt);
  return (
    <footer className={className}>
      <div className="flex flex-col gap-1 border-t border-line pt-4 text-[13px] leading-[18px] text-ink-muted sm:flex-row sm:items-baseline sm:justify-between">
        <p>
          <span className="text-ink">{DATA_MODE_LABEL[provenanceFor(plan).dataMode]}.</span> Aggregate signals; no ticket-sales or individual predictions.
        </p>
        <p>
          Routing, room sizes and costs are Soundcheck assumptions.
          {date && <> Generated {date}.</>}
        </p>
      </div>
    </footer>
  );
}
