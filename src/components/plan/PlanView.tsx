"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import type { Plan } from "@/lib/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { prefersReducedMotion, useDebounced } from "@/components/ui/motion";
import { CityCard } from "./CityCard";
import { PlanHeader } from "./PlanHeader";
import { ProvenanceFooter } from "./ProvenanceFooter";
import { QuadrantChart } from "./QuadrantChart";
import { RouteStrip } from "./RouteStrip";
import { SiteBar } from "./SiteBar";
import { TraceRail } from "./TraceRail";
import { WithoutQlooPanel } from "./WithoutQlooPanel";

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

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 lg:px-12">
      <SiteBar />
      <div className="flex flex-col gap-8">
        <PlanHeader plan={plan} comparing={comparing} onToggleCompare={() => setComparing((c) => !c)} />
        {comparing && <WithoutQlooPanel plan={plan} />}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-12">
          <div className="min-[900px]:col-span-7">
            <div role="region" aria-label="Tour map" className="h-[360px] overflow-hidden rounded-md border border-line bg-bg-sunken min-[900px]:h-full min-[900px]:min-h-[460px]">
              <PlanMap plan={plan} selectedStop={sel.mapStop} onSelectStop={sel.toggle} mode="plan" className="h-full w-full" />
            </div>
          </div>
          <div className="min-[900px]:col-span-5">
            <QuadrantChart
              candidates={plan.candidates}
              stops={plan.stops}
              activeStop={sel.active}
              selected={sel.selected !== undefined && sel.selected === sel.active}
              onHoverStop={sel.setHovered}
              onSelectStop={sel.toggle}
              className="h-full"
            />
          </div>
        </div>

        <RouteStrip
          stops={plan.stops}
          selectedStop={sel.selected}
          hoveredStop={sel.hovered}
          onHoverStop={sel.setHovered}
          onSelectStop={(order) => {
            sel.setSelected(order);
            scrollToStop(order);
          }}
        />

        <section aria-label="City by city" className="flex flex-col gap-4">
          {plan.stops.map((s) => (
            <CityCard key={s.order} stop={s} poolSize={pool} selected={sel.selected === s.order} hovered={sel.hovered === s.order} onSelect={sel.toggle} onHover={sel.setHovered} />
          ))}
        </section>

        <TraceRail variant="footer" steps={plan.trace} summary={plan.summary} />
        <ProvenanceFooter plan={plan} />
      </div>
    </div>
  );
}
