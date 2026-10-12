"use client";

import type { Pick, Stop } from "@/lib/types";
import { AudienceBars } from "@/components/ui/AudienceBars";
import { LimitedData } from "@/components/ui/LimitedData";
import { MarketBadge } from "@/components/ui/MarketBadge";
import { QlooTag } from "@/components/ui/QlooTag";
import { StopMarker } from "@/components/ui/StopMarker";
import { WhyPopover } from "@/components/ui/WhyPopover";
import { CountUp, useInView } from "@/components/ui/motion";
import { cn } from "@/components/ui/cn";
import { splitFigures } from "./format";
import { BreakEvenLine } from "./RouteEconomics";
import type { BreakEven, Rates, Units } from "@/lib/economics";

interface Props {
  stop: Stop;
  /** Size of the scored pool, for "rank 3/38". */
  poolSize: number;
  selected?: boolean;
  hovered?: boolean;
  onSelect?: (order: number) => void;
  onHover?: (order: number | undefined) => void;
  /** Count-up and bar fills. Off for print. */
  animate?: boolean;
  /** Print view: reasons shown inline instead of in popovers, no interaction. */
  print?: boolean;
  /** Travel-and-crew break-even for this stop, from the route economics state. Omitted: no line. */
  breakEven?: { b: BreakEven; units: Units; rates: Rates };
  className?: string;
}

function Group({ label, qloo = true, children }: { label: string; qloo?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1 flex items-center gap-2">
        {label} {qloo && <QlooTag />}
      </div>
      {children}
    </div>
  );
}

function PickRows({ picks, kind, showOverlap, print }: { picks: Pick[]; kind: string; showOverlap?: boolean; print?: boolean }) {
  return (
    <ul>
      {picks.map((p) => (
        <li key={p.id} className="border-b border-line py-1.5 last:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] leading-[22px]">{p.name}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              {showOverlap && p.overlap !== undefined && <span className="num text-[13px] leading-[18px] text-ink-muted">overlap {Math.round(p.overlap * 100)}%</span>}
              {!print && <WhyPopover title={`${kind} ${p.name}`} reason={p.reason} tags={p.tags} />}
            </span>
          </div>
          {print && <p className="text-xs leading-4 text-ink-muted">{p.reason}</p>}
        </li>
      ))}
    </ul>
  );
}

/** One card per stop. Affinity counts up when the card scrolls into view; audience bars fill after it. */
export function CityCard({ stop, poolSize, selected = false, hovered = false, onSelect, onHover, animate = true, print = false, breakEven, className }: Props) {
  const { city, demographics, openers, sponsors, places } = stop;
  const [ref, inView] = useInView<HTMLElement>(animate);
  const play = inView;
  const interactive = !print;
  return (
    <article
      ref={ref}
      id={`stop-${stop.order}`}
      aria-labelledby={`stop-${stop.order}-title`}
      onClick={interactive ? () => onSelect?.(stop.order) : undefined}
      onPointerEnter={interactive ? () => onHover?.(stop.order) : undefined}
      onPointerLeave={interactive ? () => onHover?.(undefined) : undefined}
      className={cn(
        "sc-link scroll-mt-6 rounded-md border bg-bg-raised p-5 sm:p-6",
        selected ? "border-spot bg-spot-soft" : hovered ? "border-line-strong" : "border-line",
        interactive && "cursor-pointer",
        className,
      )}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <StopMarker n={stop.order} size={26} />
          <h3 id={`stop-${stop.order}-title`} className="font-display text-[40px] font-bold uppercase leading-10 tracking-[0.01em]">
            {interactive ? (
              <button type="button" aria-pressed={selected} className="rounded-sm text-left uppercase" onClick={(e) => { e.stopPropagation(); onSelect?.(stop.order); }}>
                {city.name}
              </button>
            ) : (
              city.name
            )}
          </h3>
        </div>
        <MarketBadge quadrant={city.quadrant} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_1.15fr]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="label mb-1 flex items-center gap-2">
              Affinity <QlooTag />
            </div>
            <div className="text-signal">
              <CountUp value={city.affinity} play={play} animate={animate} className="text-[32px] font-medium leading-9" />
            </div>
            <p className="num text-[13px] leading-[18px] text-ink-muted">
              rank {city.affinityRank}/{poolSize} · popularity <CountUp value={city.popularity} play={play} animate={animate} />
            </p>
            {city.status !== "ok" && <LimitedData status={city.status} className="mt-3">Limited Qloo data for this market. Scores are indicative.</LimitedData>}
          </div>
          <div>
            <div className="label mb-1">Soundcheck suggests</div>
            <p className="text-[15px] leading-[22px]">{stop.suggestion}</p>
            {breakEven && (
              <div className="mt-1.5">
                <BreakEvenLine b={breakEven.b} units={breakEven.units} rates={breakEven.rates} />
              </div>
            )}
          </div>
        </div>

        <AudienceBars demographics={demographics} play={play} animate={animate} />

        <div className="flex flex-col gap-4">
          <Group label="Openers">
            {openers.length ? <PickRows picks={openers} kind="opener" showOverlap print={print} /> : <LimitedData>Limited Qloo data for openers in this market.</LimitedData>}
          </Group>
          <Group label="Sponsors">
            {sponsors.length ? <PickRows picks={sponsors} kind="sponsor" print={print} /> : <LimitedData>Limited Qloo data for sponsors in this market.</LimitedData>}
          </Group>
          <Group label="Activate">
            {places.length ? <PickRows picks={places} kind="venue" print={print} /> : <LimitedData>Limited Qloo data for local venues in this market.</LimitedData>}
          </Group>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="label mb-1">Why here</div>
        <p className="max-w-[65ch] text-[15px] leading-[22px]">
          {splitFigures(stop.whyHere).map((part, i) => (part.figure ? <span key={i} className="num">{part.text}</span> : <span key={i}>{part.text}</span>))}{" "}
          <QlooTag />
        </p>
      </div>
    </article>
  );
}
