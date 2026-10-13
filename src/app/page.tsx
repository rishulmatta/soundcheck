import { Suspense } from "react";
import { DemoCards } from "@/components/landing/DemoCards";
import { LandingMap, LandingMapFallback } from "@/components/landing/LandingMap";
import { LandingForm } from "@/components/plan/LandingForm";
import { SiteBar } from "@/components/plan/SiteBar";
import { Button } from "@/components/ui/Button";
import { ArrowRight } from "@/components/ui/icons";
import { QlooTag } from "@/components/ui/QlooTag";
import { StopMarker } from "@/components/ui/StopMarker";
import { stagger } from "@/components/ui/stagger";

const STEPS = [
  {
    title: "Name the act",
    body: "Any musician, comedian or live podcast. Soundcheck finds it in Qloo's taste graph and pulls its audience.",
  },
  {
    title: "Score every city",
    body: "Fan affinity against current popularity for each metro in the region. Top left of the quadrant is where the fans are and nobody has played.",
  },
  {
    title: "Take the routed plan",
    body: "Ordered stops with travel days, openers with real fan overlap, sponsors, venues and a one-line why for every city. Share it, print it, or revise it by hand.",
  },
];

const PROOF = ["Openers ranked by fan overlap", "Sponsors and activations per stop", "Share link, print to PDF, CSV"];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col px-4 pb-16 lg:px-12">
      <SiteBar
        right={
          <nav className="flex items-center gap-2 sm:gap-4">
            <a href="#how" className="hidden text-sm font-semibold leading-5 text-ink-muted transition-colors duration-150 hover:text-ink sm:inline">
              How it works
            </a>
            <a href="#plans" className="hidden text-sm font-semibold leading-5 text-ink-muted transition-colors duration-150 hover:text-ink sm:inline">
              Finished plans
            </a>
            <Button href="#plan" variant="primary" size="sm">
              Plan a tour
            </Button>
          </nav>
        }
      />

      <section className="mt-8 grid gap-8 sm:mt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch lg:gap-10">
        <div className="flex flex-col justify-center gap-6">
          <p className="label flex items-center gap-2">
            Tour intelligence <span aria-hidden="true">·</span> built on <QlooTag />
          </p>
          <h1 className="sc-set font-display text-[48px] font-bold uppercase leading-[46px] sm:text-[64px] sm:leading-[60px]">
            Route the tour to where the fans already are.
          </h1>
          <p className="max-w-[52ch] text-[17px] leading-[26px] text-ink-muted">
            Soundcheck scores every city in a region on fan affinity against how often the act plays there, finds the markets that are primed but nobody
            has booked, and routes a tour through them. Openers, sponsors and local activations for every stop, each one explained and sourced.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button href="/plan/demo-musician" variant="primary" icon={<ArrowRight />} className="flex-row-reverse">
              See a finished plan
            </Button>
            <Button href="#plan" variant="secondary">
              Plan your own
            </Button>
          </div>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-[18px] text-ink-muted sm:flex-row sm:flex-wrap sm:gap-x-5">
            {PROOF.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-spot" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="sc-enter" style={stagger(1, 40, 120)}>
          <Suspense fallback={<LandingMapFallback />}>
            <LandingMap />
          </Suspense>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="mt-16 flex scroll-mt-8 flex-col gap-6 sm:mt-20">
        <div className="flex items-center gap-4">
          <h2 id="how-title" className="label whitespace-nowrap">
            How it works
          </h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="sc-enter flex flex-col gap-3 rounded-md border border-line bg-bg-raised p-5" style={stagger(i, 40, 160)}>
              <StopMarker n={i + 1} size={28} />
              <h3 className="font-display text-[26px] font-semibold leading-7">{step.title}</h3>
              <p className="text-[15px] leading-[22px] text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="plans" aria-labelledby="demos-title" className="mt-16 flex scroll-mt-8 flex-col gap-6 sm:mt-20">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <h2 id="demos-title" className="label whitespace-nowrap">
              Finished plans
            </h2>
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>
          <p className="max-w-[60ch] text-[15px] leading-[22px] text-ink-muted">
            Three tours already planned. Open one to see the map, the quadrant, every city card and the full agent trace. No waiting.
          </p>
        </div>
        <DemoCards />
      </section>

      <section id="plan" aria-labelledby="custom-title" className="mt-16 flex scroll-mt-8 flex-col gap-6 sm:mt-20">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <h2 id="custom-title" className="label whitespace-nowrap">
              Plan your own
            </h2>
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>
          <p className="max-w-[60ch] text-[15px] leading-[22px] text-ink-muted">
            Name the act and pick a region. You watch the agent resolve the act, score the cities, route the tour and explain each pick as it goes. About
            two minutes.
          </p>
        </div>
        <LandingForm />
      </section>

      <footer className="mt-16 flex flex-col gap-1 border-t border-line pt-4 text-[13px] leading-[18px] text-ink-muted sm:flex-row sm:items-baseline sm:justify-between">
        <p>
          <span className="text-ink">Data:</span> Qloo aggregate affinities. Not predictions about individuals.
        </p>
        <p>Routing, room sizes and activations are Soundcheck&apos;s interpretation.</p>
      </footer>
    </main>
  );
}
