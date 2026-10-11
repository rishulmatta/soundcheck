import sample from "@/fixtures/plan.sample.json";
import type { Plan } from "@/lib/types";
import { SEEDED_PLAN_IDS } from "@/lib/store";
import { SEEDS } from "@/lib/seeds";
import { DemoCard, type DemoCardData } from "@/components/plan/DemoCard";
import { LandingForm } from "@/components/plan/LandingForm";
import { projectPlan, seededRoute } from "@/components/plan/RouteSketch";
import { REGION_LABEL } from "@/components/plan/format";

const musician = sample as unknown as Plan;
const sketch = projectPlan(musician);

const KIND: Record<string, string> = { artist: "Musician", person: "Comedian", podcast: "Live podcast" };

/** Descriptors for the three seeded plans, driven by src/lib/seeds.ts. The musician card's sketch comes from the sample fixture. */
const DEMOS = Object.fromEntries(
  SEEDS.map((seed) => [
    seed.id,
    {
      id: seed.id,
      kind: KIND[seed.input.actType] ?? "Act",
      name: seed.input.actQuery,
      region: REGION_LABEL[seed.input.region],
      stops: seed.input.stops,
      window: seed.input.window ?? "2027",
      route: seed.id === "demo-musician" ? sketch.route : seededRoute(seed.id, seed.input.stops),
      heat: seed.id === "demo-musician" ? sketch.heat : undefined,
    } satisfies DemoCardData,
  ]),
) as Record<(typeof SEEDED_PLAN_IDS)[number], DemoCardData>;

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
