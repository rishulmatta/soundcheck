"use client";
/**
 * Presentation mode: the plan as a self-running show. This component only wires things together.
 *   sequencer (src/lib/tour/sequencer.ts)  ->  cues  ->  map controller (camera, route, bloom)
 *                                          ->  phases ->  React state for the card and header (a few changes per stop)
 *                                          ->  ticks  ->  route draw, progress ring (direct writes, no renders)
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { DataSourceProvider } from "@/components/ui/QlooTag";
import { DATA_MODE_LABEL } from "@/components/plan/ProvenanceBanner";
import type { TourStatus } from "@/lib/tour/sequencer";
import { INITIAL_VIEW, TourDirector, type MapSlot, type ViewState } from "./director";
import { MiniQuadrant } from "./MiniQuadrant";
import { TourCard } from "./TourCard";
import { TourControls } from "./TourControls";
import { TourSummary } from "./TourSummary";
import { useReducedMotion } from "./useReducedMotion";
import "./tour.css";

const PlanMap = dynamic(() => import("@/components/map/PlanMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg-sunken" />,
});

export function TourView({ plan }: { plan: Plan }) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const stopCount = plan.stops.length;
  const { dataMode } = provenanceFor(plan);

  const [mapSlot] = useState<MapSlot>(() => ({ current: null }));
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [status, setStatus] = useState<TourStatus>("idle");

  const director = useMemo(
    () => new TourDirector(plan, reducedMotion, mapSlot, { onView: setView, onStatus: setStatus }),
    [plan, reducedMotion, mapSlot],
  );

  useEffect(() => {
    director.attach();
    return () => director.destroy();
  }, [director]);

  // Keyboard: Space, arrows, Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = (e.target as HTMLElement | null)?.closest?.("button, a, input, textarea, select, [role='button']");
      if (e.key === " " || e.code === "Space") {
        if (onControl) return; // let the focused control handle its own activation
        e.preventDefault();
        director.toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        director.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        director.prev();
      } else if (e.key === "Escape") {
        router.push(`/plan/${plan.id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [director, router, plan.id]);

  // A hidden tab stops requestAnimationFrame but not time, so hold the clock instead of letting it leap.
  useEffect(() => {
    const onVisibility = () => director.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [director]);

  const onReady = useCallback(() => director.setReady(), [director]);
  const onUserDrag = useCallback((dragging: boolean) => director.setDrag(dragging), [director]);

  const current = view.finale ? undefined : plan.stops[Math.min(view.index, stopCount - 1)];
  const cardStop = plan.stops[view.cardStop];
  const playing = status === "playing";

  return (
    <DataSourceProvider mode={dataMode}>
    <main className="fixed inset-0 overflow-hidden bg-bg-sunken text-ink">
      <div className="absolute inset-0">
        <PlanMap
          plan={plan}
          mode="tour"
          controllerRef={mapSlot}
          selectedStop={current?.order}
          onReady={onReady}
          onUserDrag={onUserDrag}
          className="h-full w-full !rounded-none"
        />
      </div>

      {/* Top-left: act and where we are. */}
      <header className="pointer-events-none absolute left-4 top-4 flex max-w-[60%] flex-col gap-1 sm:left-6 sm:top-6">
        <p className="m-0 rounded-sm bg-bg-raised/95 px-2 py-1 text-xs font-semibold text-ink">{DATA_MODE_LABEL[dataMode]} · provisional markets</p>
        <p className="m-0 font-display text-[26px] font-semibold leading-7">{plan.act.name}</p>
        <div key={view.finale ? "finale" : view.index} className="tour-fade flex flex-col">
          <p className="label m-0">{view.finale ? "Finale" : `Stop ${view.index + 1} of ${stopCount}`}</p>
          <p className="disp m-0 text-[40px] leading-10">{view.finale ? "Full route" : current?.city.name}</p>
        </div>
      </header>

      {/* Top-right: quadrant thumbnail and close. */}
      <div className="absolute right-4 top-4 flex items-start gap-3 sm:right-6 sm:top-6">
        <div className="pointer-events-none hidden rounded-md border border-line bg-bg-raised p-2 sm:block">
          <MiniQuadrant candidates={plan.candidates} currentId={current?.city.id} />
        </div>
        <Link
          href={`/plan/${plan.id}`}
          aria-label="Close tour"
          className="tc-ib grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-bg-raised text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
      </div>

      {/* Bottom: card above the controls on phones and tablets; side by side from lg. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-col items-start gap-3 sm:inset-x-6 sm:bottom-6 lg:block">
        <div
          className="pointer-events-auto w-full sm:w-auto lg:absolute lg:bottom-0 lg:left-0"
          onMouseEnter={() => director.setHover(true)}
          onMouseLeave={() => director.setHover(false)}
        >
          {view.finale ? (
            <TourSummary plan={plan} phase={view.cardPhase} onReplay={() => director.replay()} />
          ) : (
            cardStop && <TourCard plan={plan} stop={cardStop} pool={plan.candidates.length} phase={view.cardPhase} reducedMotion={reducedMotion} />
          )}
        </div>
        <div className="pointer-events-none flex w-full justify-center lg:absolute lg:bottom-0 lg:left-1/2 lg:w-auto lg:-translate-x-1/2">
          <TourControls
            stops={plan.stops}
            index={view.index}
            playing={playing}
            controller={director.controller}
            onPrev={() => director.prev()}
            onNext={() => director.next()}
            onToggle={() => director.toggle()}
            onSeek={(i) => director.seek(i)}
          />
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {view.finale ? "Tour finished. Full route shown." : `Stop ${view.index + 1} of ${stopCount}: ${current?.city.name}`}
      </p>
    </main>
    </DataSourceProvider>
  );
}
