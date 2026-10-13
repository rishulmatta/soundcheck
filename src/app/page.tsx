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
    body: "Start with a musician. Soundcheck resolves the artist in Qloo’s taste graph and finds relevant audience signals.",
  },
  {
    title: "Investigate markets",
    body: "Explore affinity and popularity signals across a regional city pool. Comparisons are provisional; popularity is not performance history.",
  },
  {
    title: "Take the routed plan",
    body: "Review travel costs, related openers, sponsor ideas and local activations. Lock a city, drop a stop, then export a brief for your team.",
  },
];

const PROOF = ["Openers connected by taste", "Sponsors and activations per stop", "Share link, print to PDF, CSV"];

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
            For independent artist managers <span aria-hidden="true">·</span> <QlooTag mode="live" />
          </p>
          <h1 className="sc-set font-display text-[48px] font-bold uppercase leading-[46px] sm:text-[64px] sm:leading-[60px]">
            Find your next tour markets.
          </h1>
          <p className="max-w-[52ch] text-[17px] leading-[26px] text-ink-muted">
            Discover promising markets, assess travel tradeoffs, and find culturally aligned partners. Soundcheck turns audience signals into an editable tour shortlist, with evidence and assumptions alongside each recommendation.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button href="/plan/demo-musician" variant="primary" icon={<ArrowRight />} className="flex-row-reverse">
              Explore the musician example
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
            Start with the musician example: inspect a city’s evidence, revise a stop, and export the brief. Each saved plan shows its data source. Comedian and podcast examples are experimental.
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
            Name an artist and pick a region. Follow the agent as it gathers signals, proposes a route and explains its choices. Runtime varies with data availability.
          </p>
        </div>
        <LandingForm />
      </section>

      <footer className="mt-16 flex flex-col gap-1 border-t border-line pt-4 text-[13px] leading-[18px] text-ink-muted sm:flex-row sm:items-baseline sm:justify-between">
        <p>
          <span className="text-ink">Evidence:</span> Plans distinguish Qloo API data, synthetic examples and unverified sources.
        </p>
        <p>Shortlists to investigate, with room sizes and costs shown as assumptions.</p>
      </footer>
    </main>
  );
}
