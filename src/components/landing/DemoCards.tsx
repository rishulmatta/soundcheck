import { connection } from "next/server";
import { Suspense } from "react";
import type { ActType } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { SEEDED_PLAN_IDS, getPlan } from "@/lib/store";
import { seedById } from "@/lib/seeds";
import { DemoCard, DemoCardSkeleton, type DemoCardData } from "@/components/plan/DemoCard";
import { projectPlan } from "@/components/plan/RouteSketch";
import { REGION_LABEL } from "@/components/plan/format";

const KIND: Partial<Record<ActType, string>> = { artist: "Musician", person: "Comedian", podcast: "Live podcast" };

/** The three seeded plans, each drawn from the plan actually stored on the server. Never generates one. */
export function DemoCards() {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {SEEDED_PLAN_IDS.map((id, i) => (
        <Suspense key={id} fallback={<DemoCardSkeleton />}>
          <LiveDemoCard id={id} index={i} />
        </Suspense>
      ))}
    </ul>
  );
}

async function LiveDemoCard({ id, index }: { id: (typeof SEEDED_PLAN_IDS)[number]; index: number }) {
  await connection();
  const seed = seedById(id);
  const plan = await getPlan(id);
  const input = plan?.input ?? seed?.input;
  if (!input) return null;

  const sketch = plan ? projectPlan(plan) : undefined;
  const untapped = plan?.stops.filter((s) => s.city.quadrant === "untapped").map((s) => s.city.name) ?? [];
  const strongest = plan ? [...plan.stops].sort((a, b) => b.city.affinity - a.city.affinity)[0]?.city.name : undefined;
  const highlight = untapped.length
    ? { label: "Investigate", text: untapped.slice(0, 3).join(", ") }
    : strongest
      ? { label: "Highest provisional affinity", text: strongest }
      : undefined;

  const demo: DemoCardData = {
    id,
    kind: `${KIND[input.actType] ?? "Act"}${input.actType === "artist" ? " · featured example" : " · experimental"}`,
    dataMode: plan ? provenanceFor(plan).dataMode : "unknown",
    name: plan?.act.name ?? input.actQuery,
    region: REGION_LABEL[input.region],
    stops: plan?.stops.length ?? input.stops,
    window: input.window ?? "2027",
    route: sketch?.route,
    heat: sketch?.heat,
    highlight,
  };
  return <DemoCard demo={demo} index={index} />;
}
