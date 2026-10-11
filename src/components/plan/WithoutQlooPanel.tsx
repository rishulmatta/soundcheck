import type { Plan } from "@/lib/types";
import { MarketBadge } from "@/components/ui/MarketBadge";
import { QlooTag } from "@/components/ui/QlooTag";
import { StopMarker } from "@/components/ui/StopMarker";

/** Side-by-side: the plain-LLM plan for the same inputs, next to the Qloo-grounded route. */
export function WithoutQlooPanel({ plan }: { plan: Plan }) {
  const w = plan.withoutQloo;
  if (!w) return null;
  const grounded = new Set(plan.stops.map((s) => s.city.name));
  const plain = new Set(w.cities);
  return (
    <section aria-labelledby="compare-title" className="sc-enter rounded-md border border-line bg-bg-raised p-4 sm:p-5">
      <h2 id="compare-title" className="mb-4 font-display text-[26px] font-semibold leading-7">Without Qloo</h2>
      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <div className="rounded-md border border-line p-4">
          <p className="label mb-2">Plain language model</p>
          <ol className="flex flex-col gap-1">
            {w.cities.map((c, i) => (
              <li key={c} className="flex items-center gap-2.5 text-[15px] leading-[22px]">
                <span className="num w-5 text-right text-xs text-ink-muted">{i + 1}</span>
                <span className={grounded.has(c) ? "" : "text-ink-muted"}>{c}</span>
              </li>
            ))}
          </ol>
          {w.openers.length > 0 && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              <span className="label mr-2">Openers</span>
              {w.openers.join(" · ")}
            </p>
          )}
          <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">{w.note}</p>
        </div>
        <div className="rounded-md border border-line p-4">
          <p className="label mb-2 flex items-center gap-2">
            With Qloo <QlooTag />
          </p>
          <ol className="flex flex-col gap-1">
            {plan.stops.map((s) => (
              <li key={s.order} className="flex items-center gap-2.5 text-[15px] leading-[22px]">
                <StopMarker n={s.order} size={20} />
                <span>{s.city.name}</span>
                {s.city.quadrant === "untapped" && <MarketBadge quadrant="untapped" size="sm" />}
                {!plain.has(s.city.name) && <span className="text-xs leading-4 text-ink-muted">not in the plain plan</span>}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
            Openers ranked by fan overlap, sponsors by audience fit, every pick with its reason.
          </p>
        </div>
      </div>
    </section>
  );
}
