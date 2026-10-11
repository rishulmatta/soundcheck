import type { Plan } from "@/lib/types";
import { formatDate } from "./format";

/** Part of the layout on every plan, not a legal footnote. */
export function ProvenanceFooter({ plan, className }: { plan: Pick<Plan, "createdAt">; className?: string }) {
  const date = formatDate(plan.createdAt);
  return (
    <footer className={className}>
      <div className="flex flex-col gap-1 border-t border-line pt-4 text-[13px] leading-[18px] text-ink-muted sm:flex-row sm:items-baseline sm:justify-between">
        <p>
          <span className="text-ink">Data:</span> Qloo aggregate affinities. Not predictions about individuals.
        </p>
        <p>
          Routing, room sizes and activations are Soundcheck&apos;s interpretation.
          {date && <> Generated {date}.</>}
        </p>
      </div>
    </footer>
  );
}
