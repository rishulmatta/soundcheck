"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { DataSourceProvider } from "@/components/ui/QlooTag";
import { Skeleton } from "@/components/ui/Skeleton";
import { prefersReducedMotion, useDebounced } from "@/components/ui/motion";
import { CityCard } from "./CityCard";
import { PlanHeader } from "./PlanHeader";
import { ProvenanceBanner } from "./ProvenanceBanner";
import { ProvenanceFooter } from "./ProvenanceFooter";
import { QuadrantChart } from "./QuadrantChart";
import { RevisionBar } from "./RevisionBar";
import { RouteStrip } from "./RouteStrip";
import { RouteEconomicsStrip, useEconomics } from "./RouteEconomics";
import { SiteBar } from "./SiteBar";
import { TraceRail } from "./TraceRail";
import { WithoutQlooPanel } from "./WithoutQlooPanel";
import { useRevisionDraft } from "./useRevisionDraft";

export const PlanMap = dynamic(() => import("@/components/map/PlanMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[360px] w-full rounded-md" />,
});

/** One shared hover/selection state: quadrant dot, map marker, route stop and city card all read and write it. */
export function useStopSelection() {
  const [selected, setSelected] = useState<number | undefined>();
  const [hovered, setHovered] = useState<number | undefined>();
  const active = hovered ?? selected;
  // The map gets the active stop after a short pause so sweeping the pointer does not make the camera chase it.
  const mapStop = useDebounced(active, 140);
  const toggle = useCallback((order: number) => setSelected((s) => (s === order ? undefined : order)), []);
  return { selected, hovered, active, mapStop, setHovered, setSelected, toggle };
}

export function scrollToStop(order: number) {
  document.getElementById(`stop-${order}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

export function PlanView({ plan }: { plan: Plan }) {
  const sel = useStopSelection();
  const [comparing, setComparing] = useState(false);
  const pool = plan.candidates.length;
  const draft = useRevisionDraft(plan);
  const { viewStops } = draft;
  // Every section reads the previewed stops, so a drag reorder shows up in the map, legs, travel days and economics at once.
  const viewPlan = useMemo<Plan>(() => (viewStops === plan.stops ? plan : { ...plan, stops: viewStops }), [plan, viewStops]);
  const econ = useEconomics(viewPlan);

  const reorder = (cityIds: string[]) => {
    // Keep the selection on the same city after it moves.
    const selectedId = sel.selected !== undefined ? viewStops.find((s) => s.order === sel.selected)?.city.id : undefined;
    draft.setOrder(cityIds);
    if (selectedId) {
      const at = cityIds.indexOf(selectedId);
      if (at >= 0) sel.setSelected(at + 1);
    }
  };

  return (
    <DataSourceProvider mode={provenanceFor(plan).dataMode}>
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-0 lg:px-12">
      <SiteBar />
      <div className="flex flex-col gap-8">
        <PlanHeader plan={plan} comparing={comparing} onToggleCompare={() => setComparing((c) => !c)} />
        <ProvenanceBanner plan={plan} />
        {comparing && <WithoutQlooPanel plan={plan} />}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-12">
          <div className="min-[900px]:col-span-7">
            <div role="region" aria-label="Tour map" className="h-[360px] overflow-hidden rounded-md border border-line bg-bg-sunken min-[900px]:h-full min-[900px]:min-h-[460px]">
              <PlanMap plan={viewPlan} selectedStop={sel.mapStop} onSelectStop={sel.toggle} mode="plan" className="h-full w-full" />
            </div>
          </div>
          <div className="min-[900px]:col-span-5">
            <QuadrantChart
              candidates={plan.candidates}
              stops={viewStops}
              comparability={provenanceFor(plan).heatmapComparability}
              activeStop={sel.active}
              selected={sel.selected !== undefined && sel.selected === sel.active}
              onHoverStop={sel.setHovered}
              onSelectStop={sel.toggle}
              className="h-full"
            />
          </div>
        </div>

        <RouteStrip
          stops={viewStops}
          onReorder={reorder}
          reordered={draft.reordered}
          onResetOrder={() => draft.setField("order", undefined)}
          selectedStop={sel.selected}
          hoveredStop={sel.hovered}
          onHoverStop={sel.setHovered}
          onSelectStop={(order) => {
            sel.setSelected(order);
            scrollToStop(order);
          }}
        />

        <RouteEconomicsStrip
          stops={viewStops}
          region={plan.input.region}
          state={econ}
          hoveredStop={sel.hovered}
          onHoverStop={sel.setHovered}
          onSelectStop={(order) => {
            sel.setSelected(order);
            scrollToStop(order);
          }}
        />

        <section aria-label="City by city" className="flex flex-col gap-4">
          {viewStops.map((s) => {
            const b = econ.breakEven.get(s.order);
            return (
              <CityCard key={s.city.id} plan={plan} stop={s} pending={{ locked: draft.isLocked(s.city.id), dropped: draft.isDropped(s.city.id) }} onLock={draft.toggleLock} onDrop={draft.toggleDrop} poolSize={pool} selected={sel.selected === s.order} hovered={sel.hovered === s.order} onSelect={sel.toggle} onHover={sel.setHovered} breakEven={b ? { b, units: econ.units, rates: econ.rates } : undefined} />
            );
          })}
        </section>

        <TraceRail variant="footer" steps={plan.provenance?.proseVersion === 2 ? plan.trace : plan.trace.map((step) => ({ ...step, summary: "Legacy summary hidden; inspect recorded source calls." }))} summary={plan.summary} />
        <ProvenanceFooter plan={plan} />
      </div>
      <RevisionBar plan={plan} draft={draft} />
    </div>
    </DataSourceProvider>
  );
}
