"use client";

import type { Pick, Plan, Stop } from "@/lib/types";
import { safePickReason, safeStopCopy } from "@/lib/provenance";
import { AudienceBars } from "@/components/ui/AudienceBars";
import { LimitedData } from "@/components/ui/LimitedData";
import { Button } from "@/components/ui/Button";
import { Lock, Trash, Undo, Unlock } from "@/components/ui/icons";
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
  plan?: Plan;
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
  /** Pending revision state for this city: locked (already or about to be) and dropped (about to be). */
  pending?: { locked: boolean; dropped: boolean };
  /** Toggle the lock on this city's draft. Providing either callback shows the action buttons. */
  onLock?: (cityId: string) => void;
  onDrop?: (cityId: string) => void;
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

function PickRows({ picks, kind, showSimilarity, print, plan }: { picks: Pick[]; kind: string; showSimilarity?: boolean; print?: boolean; plan?: Plan }) {
  return (
    <ul>
      {picks.map((p) => (
        <li key={p.id} className="border-b border-line py-1.5 last:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] leading-[22px]">{p.name}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              {showSimilarity && p.tasteSimilarity !== undefined && <span className="num text-[13px] leading-[18px] text-ink-muted" title="Soundcheck-derived taste similarity on a 0–1 scale; not audience overlap">taste similarity {p.tasteSimilarity.toFixed(2)}</span>}
              {!print && <WhyPopover title={`${kind} ${p.name}`} reason={plan ? safePickReason(plan, p) : p.reason} tags={p.tags} />}
            </span>
          </div>
          {print && <p className="text-xs leading-4 text-ink-muted">{plan ? safePickReason(plan, p) : p.reason}</p>}
        </li>
      ))}
    </ul>
  );
}

/** One card per stop. Affinity counts up when the card scrolls into view; audience bars fill after it. */
export function CityCard({ stop, plan, poolSize, selected = false, hovered = false, onSelect, onHover, animate = true, print = false, breakEven, pending, onLock, onDrop, className }: Props) {
  const { city, demographics, openers, sponsors, places } = stop;
  const copy = plan ? safeStopCopy(plan, stop) : stop;
  const [ref, inView] = useInView<HTMLElement>(animate);
  const play = inView;
  const interactive = !print;
  const locked = pending?.locked ?? false;
  const dropped = pending?.dropped ?? false;
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
        dropped && "opacity-55",
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
        <div className="flex flex-none flex-wrap items-center justify-end gap-2">
          {interactive && dropped && <span className="inline-flex h-[22px] items-center rounded-full bg-warn-soft px-2.5 font-mono text-xs font-medium leading-4 text-warn">Dropping</span>}
          {interactive && locked && !dropped && (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-spot-soft px-2.5 font-mono text-xs font-medium leading-4 text-spot">
              <Lock size={12} />
              Locked
            </span>
          )}
          <MarketBadge quadrant={city.quadrant} />
          {interactive && onLock && (
            <Button variant="ghost" size="sm" aria-pressed={locked} icon={locked ? <Unlock /> : <Lock />} onClick={(e) => { e.stopPropagation(); onLock(city.id); }}>
              {locked ? "Unlock" : "Lock"}
              <span className="sr-only"> {city.name}</span>
            </Button>
          )}
          {interactive && onDrop && (
            <Button variant="ghost" size="sm" icon={dropped ? <Undo /> : <Trash />} onClick={(e) => { e.stopPropagation(); onDrop(city.id); }}>
              {dropped ? "Keep" : "Drop"}
              <span className="sr-only"> {city.name}</span>
            </Button>
          )}
        </div>
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
              provisional rank {city.affinityRank}/{poolSize} · popularity <CountUp value={city.popularity} play={play} animate={animate} />
            </p>
            {city.status !== "ok" && <LimitedData status={city.status} className="mt-3">Limited Qloo data for this market. Scores are indicative.</LimitedData>}
          </div>
          <div>
            <div className="label mb-1">Room-size assumption</div>
            <p className="text-[15px] leading-[22px]">{copy.suggestion}</p>
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
            {openers.length ? <PickRows picks={openers} kind="opener" showSimilarity print={print} plan={plan} /> : <LimitedData>Limited Qloo data for openers in this market.</LimitedData>}
          </Group>
          <Group label="Sponsors">
            {sponsors.length ? <PickRows picks={sponsors} kind="sponsor" print={print} plan={plan} /> : <LimitedData>Limited Qloo data for sponsors in this market.</LimitedData>}
          </Group>
          <Group label="Activate">
            {places.length ? <PickRows picks={places} kind="venue" print={print} plan={plan} /> : <LimitedData>Limited Qloo data for local venues in this market.</LimitedData>}
          </Group>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="label mb-1">Why investigate · Soundcheck interpretation</div>
        <p className="max-w-[65ch] text-[15px] leading-[22px]">
          {splitFigures(copy.whyHere).map((part, i) => (part.figure ? <span key={i} className="num">{part.text}</span> : <span key={i}>{part.text}</span>))}
        </p>
      </div>
    </article>
  );
}
