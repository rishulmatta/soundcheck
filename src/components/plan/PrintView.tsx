import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { MarketBadge } from "@/components/ui/MarketBadge";
import { DataSourceProvider, QlooTag } from "@/components/ui/QlooTag";
import { StatusChip } from "@/components/ui/StatusChip";
import { CityCard } from "./CityCard";
import { PrintButton, PrintTheme } from "./PrintControls";
import { ProvenanceBanner } from "./ProvenanceBanner";
import { ProvenanceFooter } from "./ProvenanceFooter";
import { QuadrantChart } from "./QuadrantChart";
import { RouteSketch, projectPlan } from "./RouteSketch";
import { RouteStrip } from "./RouteStrip";
import { staticEconomics } from "@/lib/economics";
import { RouteEconomicsStrip } from "./RouteEconomics";
import { ACT_TYPE_LABEL, formatDate, planParams } from "./format";
import { ActLinks, ActPortrait, hasConfirmedQlooMatch } from "./ActIdentity";
import "./print.css";

const sheet = "print-sheet mx-auto w-full max-w-[820px] border border-line bg-bg-raised p-8 print:max-w-none print:border-0 print:p-0";

const TREND = { rising: "Rising", flat: "Flat", falling: "Falling", unknown: "Unavailable" } as const;

/** The promoter deliverable: cover page, then one city per page. No interactive elements except the print button. */
export function PrintView({ plan }: { plan: Plan }) {
  const { act, momentum } = plan;
  const { dataMode, heatmapComparability } = provenanceFor(plan);
  const regionNormalized = heatmapComparability === "region-normalized";
  // Qloo's trending series has been flat (velocity 0) for every act probed: say so rather than imply a measured trend.
  const trendLabel = momentum.trend === "flat" && !momentum.velocity ? "No movement in Qloo’s series" : TREND[momentum.trend];
  const confirmedMatch = hasConfirmedQlooMatch(plan);
  const sketch = projectPlan(plan);
  const untapped = plan.stops.filter((s) => s.city.quadrant === "untapped");
  const pool = plan.candidates.length;
  const econ = staticEconomics(plan);
  return (
    <DataSourceProvider mode={dataMode}>
    <div className="print-root bg-bg px-4 py-8 print:p-0">
      <PrintTheme />
      <div className="mx-auto mb-6 flex w-full max-w-[820px] items-center justify-between gap-3 print:hidden">
        <p className="text-[13px] leading-[18px] text-ink-muted">Preview of the PDF. Choose &ldquo;Save as PDF&rdquo; in the print dialog.</p>
        <PrintButton />
      </div>

      <div className="flex flex-col gap-6 print:gap-0">
        <section className={sheet} aria-label="Cover">
          <p className="label">Soundcheck · Tour plan</p>
          <div className="mt-3 flex items-start gap-5">
            <ActPortrait act={act} size={112} className="mt-2" />
            <h1 className="font-display text-[64px] font-bold uppercase leading-[60px] tracking-[0.01em]">{act.name}</h1>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] leading-[22px]">
            <span>{ACT_TYPE_LABEL[act.type]}{act.subtype ? ` · ${act.subtype}` : ""}</span>
            <StatusChip status={confirmedMatch ? "ok" : "partial"}>{confirmedMatch ? "Qloo match" : dataMode === "mock" ? "synthetic entity" : "identity unverified"}</StatusChip>
            {act.id && <span className="num text-xs text-ink-muted">{confirmedMatch ? "Qloo ID" : "Stored ID"} {act.id}</span>}
          </div>
          {act.description && <p className="mt-2 max-w-[70ch] text-[15px] leading-[22px]">{act.description}</p>}
          <ActLinks act={act} print className="mt-2" />
          <p className="mt-2 text-[15px] leading-[22px] text-ink-muted">{planParams(plan).join(" · ")}</p>
          {plan.revision !== undefined && plan.revision > 1 && (
            <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">
              Revision {plan.revision}{plan.revisionNote ? `: ${plan.revisionNote}` : ""}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px] leading-[22px]">
            <span className="label">Momentum</span>
            <QlooTag />
            <span>{trendLabel}</span>
            {momentum.velocity !== undefined && (
              <span className="text-[13px] text-ink-muted">
                rank velocity <span className="num text-ink">{momentum.velocity > 0 ? "+" : ""}{momentum.velocity.toFixed(2)}</span>
              </span>
            )}
          </p>

          <ProvenanceBanner plan={plan} className="mt-4" />

          <div className="mt-6 grid grid-cols-3 gap-4 border-y border-line py-4">
            <div>
              <p className="label">Stops</p>
              <p className="font-display text-[40px] font-bold leading-10">{plan.stops.length}</p>
            </div>
            <div>
              <p className="label">Investigate</p>
              <p className="font-display text-[40px] font-bold leading-10">{untapped.length}</p>
            </div>
            <div>
              <p className="label">{dataMode === "mock" ? "Simulated calls" : "Data calls"}</p>
              <p className="num text-[40px] font-medium leading-10">{plan.summary.qlooCalls}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="overflow-hidden rounded-md border border-line">
              <RouteSketch route={sketch.route} heat={sketch.heat} numbers width={360} height={300} className="block h-auto w-full" label={`Route for ${act.name}`} />
            </div>
            <QuadrantChart candidates={plan.candidates} stops={plan.stops} comparability={heatmapComparability} animate={false} panel={false} className="rounded-md border border-line bg-bg-raised p-2" />
          </div>
          <p className="mt-2 text-xs leading-4 text-ink-muted">Left: route and heat by fan affinity. Right: affinity against popularity for {pool} candidate cities;{" "}
            {regionNormalized
              ? "the shaded area is primed (affinity 0.5 or more) and less known than its fit suggests (affinity above popularity), from one region-wide Qloo heatmap. Rankings are Soundcheck heuristics."
              : "the shaded cell has higher affinity and lower popularity. Rankings are provisional."}
          </p>

          <ProvenanceFooter plan={plan} className="mt-6" />
        </section>

        <section className={sheet} aria-label="Route and cost assumptions">
          <h2 className="font-display text-[26px] font-semibold leading-7">Route and cost assumptions</h2>
          <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">{act.name} · {plan.stops.length} proposed stops. Confirm demand, availability and a complete show budget before booking.</p>
          <RouteStrip stops={plan.stops} animate={false} interactive={false} className="mt-6" />
          <RouteEconomicsStrip stops={plan.stops} region={plan.input.region} state={{ tier: econ.tier, rates: econ.rates, units: econ.units, economics: econ.economics, room: econ.room }} editable={false} className="mt-4" />
          <ProvenanceFooter plan={plan} className="mt-6" />
        </section>

        {plan.stops.map((s) => (
          <section key={s.order} className={sheet} aria-label={`Stop ${s.order}, ${s.city.name}`}>
            <p className="label mb-3 flex items-center gap-2">
              {act.name} · stop <span className="num">{s.order}</span> of <span className="num">{plan.stops.length}</span>
              {s.legDays > 0 && <> · <span className="num">{s.legDays}</span> travel days from the previous stop</>}
            </p>
            <CityCard plan={plan} stop={s} poolSize={pool} animate={false} print className="p-6" breakEven={econ.breakEven.get(s.order) ? { b: econ.breakEven.get(s.order)!, units: econ.units, rates: econ.rates } : undefined} />
            {s.city.quadrant === "untapped" && (
              <p className="mt-3 flex items-center gap-2 text-[13px] leading-[18px] text-ink-muted">
                <MarketBadge quadrant="untapped" size="sm" />{" "}
                {regionNormalized ? "Primed, and less known than its fit suggests." : "Higher affinity, lower popularity."} A market to investigate; booking history is unknown.
              </p>
            )}
            <ProvenanceFooter plan={plan} className="mt-6" />
          </section>
        ))}

        <section className={sheet} aria-label="Method">
          <h2 className="font-display text-[26px] font-semibold leading-7">How this plan was made</h2>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-muted">
            Generated {formatDate(plan.createdAt)}. Representative requests below have keys and entity IDs redacted. The interactive plan has the complete call trace.
            {plan.summary.model && plan.summary.model.calls > 0 && (
              <> Model {plan.summary.model.id}: <span className="num">{plan.summary.model.calls}</span> calls, <span className="num">{plan.summary.model.inputTokens.toLocaleString("en-US")}</span> input tokens (<span className="num">{plan.summary.model.cacheReadTokens.toLocaleString("en-US")}</span> from cache), <span className="num">{plan.summary.model.outputTokens.toLocaleString("en-US")}</span> output tokens.</>
            )}
          </p>
          <ol className="mt-4">
            {plan.trace.map((t) => (
              <li key={t.id} className="border-t border-line py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold leading-5">{t.name}</span>
                  <StatusChip status={t.status} size="sm" />
                </div>
                <p className="num text-xs leading-4 text-ink-muted">{plan.provenance?.proseVersion === 2 ? t.summary : "Legacy summary hidden; source calls retained."}</p>
                {Array.from(new Set(t.calls.flatMap((c) => c.note ? [c.note] : []))).map((note) => (
                  <p key={note} className="mt-1 text-xs leading-4 text-ink-muted"><span className="font-semibold">Evidence note:</span> {note}</p>
                ))}
                {t.calls.slice(0, 1).map((c, i) => (
                  <code key={i} className="num mt-1 block break-all text-[11px] leading-4 text-ink-faint">{c.request}</code>
                ))}
              </li>
            ))}
          </ol>
          <ProvenanceFooter plan={plan} className="mt-6" />
        </section>
      </div>
    </div>
    </DataSourceProvider>
  );
}
