"use client";

import dynamic from "next/dynamic";
import type { Plan } from "@/lib/types";

const PlanMap = dynamic(() => import("@/components/map/PlanMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg-sunken" />,
});

/** The landing hero: the finished demo plan on the real map, drawn once, no controls. */
export function HeroMap({ plan }: { plan: Plan }) {
  return <PlanMap plan={plan} mode="hero" className="h-full w-full" />;
}
