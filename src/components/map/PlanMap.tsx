"use client";
/**
 * The MapLibre map. Stub so the plan page can render before the map workstream lands.
 * Contract (keep these props; the map workstream owns this file):
 *  - plan: the full Plan (candidates for heatmap points, stops for the route and markers)
 *  - selectedStop: 1-based order of the highlighted stop, if any
 *  - onSelectStop: called when a marker is clicked
 *  - mode: "plan" (interactive, fits the whole route) or "tour" (camera driven by the sequencer)
 *  - controllerRef: imperative handle for the tour: flyToStop(order), fitRoute(), setRouteProgress(order, t 0..1), setBloom(order, on)
 */
import type { Plan } from "@/lib/types";
import type { MutableRefObject } from "react";

export interface PlanMapController {
  flyToStop(order: number, opts?: { durationMs?: number }): void;
  fitRoute(opts?: { durationMs?: number }): void;
  setRouteProgress(order: number, t: number): void;
  setBloom(order: number, on: boolean): void;
}

export interface PlanMapProps {
  plan: Plan;
  selectedStop?: number;
  onSelectStop?: (order: number) => void;
  mode?: "plan" | "tour";
  controllerRef?: MutableRefObject<PlanMapController | null>;
  className?: string;
}

export default function PlanMap({ plan, className }: PlanMapProps) {
  return (
    <div className={className} style={{ background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", minHeight: 360, display: "grid", placeItems: "center", color: "var(--ink-muted)" }}>
      Map: {plan.stops.length} stops (map workstream pending)
    </div>
  );
}
