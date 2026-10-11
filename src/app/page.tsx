import sample from "@/fixtures/plan.sample.json";
import type { Plan } from "@/lib/types";
import { SEEDED_PLAN_IDS } from "@/lib/store";
import { DemoCard, type DemoCardData } from "@/components/plan/DemoCard";
import { LandingForm } from "@/components/plan/LandingForm";
import { projectPlan, seededRoute } from "@/components/plan/RouteSketch";
import { REGION_LABEL } from "@/components/plan/format";

const musician = sample as unknown as Plan;
const sketch = projectPlan(musician);

/**
 * Descriptors for the three seeded plans. The musician is read from the sample fixture; the comedian and podcast
 * descriptors are placeholders until their plans are seeded (they match the shape in docs/UX.md).
 */
const DEMOS: Record<(typeof SEEDED_PLAN_IDS)[number], DemoCardData> = {
  "demo-musician": {
    id: "demo-musician",
    kind: "Musician",
    name: musician.act.name,
    region: REGION_LABEL[musician.input.region],
    stops: musician.stops.length,
    window: musician.input.window ?? "Jan–Mar 2027",
    route: sketch.route,
    heat: sketch.heat,
  },
  "demo-comedian": {
    id: "demo-comedian",
    kind: "Comedian",
    name: "The Example Comic",
    region: "North America",
    stops: 10,
    window: "Jan–Mar 2027",
    route: seededRoute("demo-comedian", 10),
  },
  "demo-podcast": {
    id: "demo-podcast",
    kind: "Live podcast",
    name: "The Example Show",
    region: "US + Canada",
    stops: 8,
    window: "Apr–Jun 2027",
    route: seededRoute("demo-podcast", 8),
  },
};

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col px-4 pb-16 pt-12 sm:pt-16 lg:px-12">
      <header className="flex flex-col gap-3">
        <h1 className="sc-set font-display text-[56px] font-bold uppercase leading-[56px] sm:text-[64px] sm:leading-[60px]">Soundcheck</h1>
        <p className="font-display text-[26px] font-semibold leading-7">Tour intelligence for any live act.</p>
        <p className="max-w-[65ch] text-[15px] leading-[22px] text-ink-muted">Run a soundcheck on your tour before anyone books a venue.</p>
      </header>

      <section aria-labelledby="demos-title" className="mt-12 flex flex-col gap-4">
        <h2 id="demos-title" className="label">Open a finished plan</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {SEEDED_PLAN_IDS.map((id, i) => (
            <DemoCard key={id} demo={DEMOS[id]} index={i} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="custom-title" className="mt-12 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <h2 id="custom-title" className="label whitespace-nowrap">Or plan your own</h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        <LandingForm />
      </section>

      <footer className="mt-12 border-t border-line pt-4 text-[13px] leading-[18px] text-ink-muted">
        Data: Qloo aggregate affinities. Not predictions about individuals.
      </footer>
    </main>
  );
}
