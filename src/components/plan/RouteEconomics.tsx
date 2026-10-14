"use client";

import { useId, useMemo, useState } from "react";
import type { BudgetTier, PlanInput, Region, Stop } from "@/lib/types";
import { BUDGET_TIER_LABEL, capacityBasis, formatInt, formatMoney, ratesFor, routeEconomics, stopBreakEven, unitsFor, type BreakEven, type Rates, type RouteEconomics as Econ, type Units } from "@/lib/economics";
import { resolveRoomTier, type ResolvedRoomTier } from "@/lib/room";
import { StopMarker } from "@/components/ui/StopMarker";
import { cn } from "@/components/ui/cn";

export interface EconomicsState {
  tier: BudgetTier;
  rates: Rates;
  units: Units;
  economics: Econ;
  /** The room tier every suggested capacity is anchored on: stated in the brief, or guessed from act popularity. */
  room: ResolvedRoomTier;
  /** Break-even per stop order, computed once for every card. */
  breakEven: Map<number, BreakEven>;
  setTier: (t: BudgetTier) => void;
  setRate: (k: keyof Rates, v: number) => void;
  reset: () => void;
  edited: boolean;
}

interface EconInput {
  /** Absent only on the run page before the input is known. */
  input?: Pick<PlanInput, "budgetTier" | "region" | "roomTier">;
  stops: Stop[];
  act?: { popularity?: number };
}

/** One state for the strip and every city card: tier, editable rates, and the derived numbers. */
export function useEconomics(plan: EconInput): EconomicsState {
  const initial = plan.input?.budgetTier ?? "bus";
  const region = plan.input?.region ?? "north-america";
  const actPopularity = plan.act?.popularity;
  const roomTier = plan.input?.roomTier;
  const room = useMemo(() => resolveRoomTier({ roomTier }, actPopularity), [roomTier, actPopularity]);
  const units = useMemo(() => unitsFor(region), [region]);
  const [tier, setTierState] = useState<BudgetTier>(initial);
  const [rates, setRates] = useState<Rates>(() => ratesFor(initial, units));
  const economics = useMemo(() => routeEconomics(plan.stops, rates, units.unit), [plan.stops, rates, units.unit]);
  const breakEven = useMemo(() => {
    const m = new Map<number, BreakEven>();
    for (const s of plan.stops) m.set(s.order, stopBreakEven(s, room, rates, economics.legs.find((l) => l.to === s.order)));
    return m;
  }, [plan.stops, room, rates, economics.legs]);
  const edited = JSON.stringify(rates) !== JSON.stringify(ratesFor(tier, units));
  return {
    tier,
    rates,
    units,
    economics,
    room,
    breakEven,
    setTier: (t) => {
      setTierState(t);
      setRates(ratesFor(t, units));
    },
    setRate: (k, v) => setRates((r) => ({ ...r, [k]: Number.isFinite(v) && v >= 0 ? v : r[k] })),
    reset: () => setRates(ratesFor(tier, units)),
    edited,
  };
}

export function EstimateTag({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-[18px] items-center rounded-sm border border-line-strong px-1.5 align-middle text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] text-ink-muted", className)}>
      Soundcheck estimate
    </span>
  );
}

const money = (n: number, u: Units) => formatMoney(n, u.currency);
const rate = (n: number, u: Units) => formatMoney(n, u.currency, 2);

/** The one-line break-even that ends the "Soundcheck suggests" block on a city card. */
export function BreakEvenLine({ b, units, rates }: { b: BreakEven; units: Units; rates: Rates }) {
  if (b.tickets === undefined || b.sellThrough === undefined) {
    return (
      <p className="text-[13px] leading-[18px] text-ink-muted">
        Flight leg in, not priced. An assumed <span className="num text-ink">{formatInt(b.capacity)}</span>-cap room would gross <span className="num text-ink">{money(b.gross, units)}</span> if sold out at a <span className="num text-ink">{money(rates.avgTicket, units)}</span> ticket.
      </p>
    );
  }
  const pct = Math.round(b.sellThrough * 100);
  const tight = b.sellThrough > 0.7;
  return (
    <p className="text-[13px] leading-[18px] text-ink-muted">
      <span className={cn("num", tight ? "text-warn" : "text-ink")}>{formatInt(b.tickets)}</span> tickets to cover modeled travel and crew, <span className={cn("num", tight ? "text-warn" : "text-ink")}>{pct}%</span> of the assumed room, for the leg in and one show day at a <span className="num text-ink">{money(rates.avgTicket, units)}</span> ticket.
      {tight && " Tight."}
    </p>
  );
}

interface StripProps {
  stops: Stop[];
  region: Region;
  state: Pick<EconomicsState, "tier" | "rates" | "units" | "economics"> & Partial<Pick<EconomicsState, "room" | "setTier" | "setRate" | "reset" | "edited">>;
  /** Print: assumptions as text, no inputs. */
  editable?: boolean;
  hoveredStop?: number;
  onHoverStop?: (order: number | undefined) => void;
  onSelectStop?: (order: number) => void;
  className?: string;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className="num text-[26px] font-medium leading-8">{value}</p>
      {sub && <p className="text-[13px] leading-[18px] text-ink-muted">{sub}</p>}
    </div>
  );
}

const RATE_FIELDS: Array<{ key: keyof Rates; label: (u: Units) => string; step: number }> = [
  { key: "perUnit", label: (u) => `Per ${u.unit}`, step: 0.1 },
  { key: "perDay", label: () => "Per day on the road", step: 100 },
  { key: "crew", label: () => "On the road", step: 1 },
  { key: "avgTicket", label: () => "Avg ticket", step: 5 },
  { key: "flightLeg", label: (u) => `Fly over (${u.unit})`, step: 50 },
];

/**
 * Route economics strip. Sits under the route. Everything here is Soundcheck's assumption from the routed distances:
 * nothing is a Qloo number, and the footnote says what is left out.
 */
export function RouteEconomicsStrip({ stops, state, editable = true, hoveredStop, onHoverStop, onSelectStop, className }: StripProps) {
  const uid = useId();
  const { tier, rates, units, economics: e } = state;
  const unitLabel = units.unit;
  const legs = e.legs;
  if (stops.length < 2) return null;
  return (
    <section className={cn("rounded-md border border-line bg-bg-raised p-4 sm:p-5", className)} aria-labelledby={`${uid}-title`}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`${uid}-title`} className="font-display text-[26px] font-semibold leading-7">Route economics</h2>
        <EstimateTag />
        <p className="text-[13px] leading-[18px] text-ink-muted">{BUDGET_TIER_LABEL[tier]}{state.edited ? ", rates edited" : ""}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Road distance" value={<>{formatInt(e.totalDistance)} <span className="text-base text-ink-muted">{unitLabel}</span></>} sub={e.longestLeg ? <>Longest leg {formatInt(e.longestLeg.distance)} {unitLabel} into {e.longestLeg.toName}</> : undefined} />
        <Stat label="Travel days" value={e.travelDays} sub={<>{e.showDays} show days, {e.showDays + e.travelDays} on the road</>} />
        <Stat label="Crew days" value={formatInt(e.crewDays)} sub={<>{rates.crew} on the road</>} />
        <Stat
          label="Travel and crew"
          value={money(e.travelCost, units)}
          sub={e.flightLegs > 0 ? <span className="text-warn">{e.flightLegs} flight {e.flightLegs === 1 ? "leg" : "legs"} not priced</span> : <>{rate(rates.perUnit, units)}/{unitLabel}, {money(rates.perDay, units)}/day</>}
        />
      </div>

      <ol className="mt-4 flex flex-wrap gap-2" aria-label="Legs">
        {legs.map((l) => {
          const hov = hoveredStop === l.to;
          const cls = cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] leading-[18px]",
            l.flight ? "border-warn bg-warn-soft" : hov ? "border-line-strong" : "border-line",
          );
          const body = (
            <>
              <StopMarker n={l.to - 1} size={16} />
              <span aria-hidden="true" className="text-ink-faint">→</span>
              <StopMarker n={l.to} size={16} />
              <span className="num">{formatInt(l.distance)} {unitLabel}</span>
              <span className="num text-ink-muted">{l.days}d</span>
              {l.flight ? <span className="font-semibold uppercase tracking-[0.08em] text-warn text-[10px]">fly</span> : <span className="num text-ink-muted">{money(l.cost, units)}</span>}
            </>
          );
          const label = `Leg into stop ${l.to}, ${l.from} to ${l.toName}: ${formatInt(l.distance)} ${unitLabel}, ${l.days} travel days${l.flight ? ", flight leg, not priced" : `, ${money(l.cost, units)}`}`;
          return (
            <li key={l.to}>
              {editable && onSelectStop ? (
                <button type="button" className={cn(cls, "sc-link cursor-pointer")} aria-label={label} onClick={() => onSelectStop(l.to)} onPointerEnter={() => onHoverStop?.(l.to)} onPointerLeave={() => onHoverStop?.(undefined)} onFocus={() => onHoverStop?.(l.to)} onBlur={() => onHoverStop?.(undefined)}>
                  {body}
                </button>
              ) : (
                <div className={cls} aria-label={label}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>

      {editable && state.setTier && state.setRate ? (
        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-sm text-[13px] font-semibold leading-[18px] text-ink-muted hover:text-ink">
            Assumptions: {BUDGET_TIER_LABEL[tier]} · {rate(rates.perUnit, units)}/{unitLabel} · {money(rates.perDay, units)}/day · {rates.crew} crew · {money(rates.avgTicket, units)} ticket
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 md:grid-cols-6">
            <div className="flex flex-col gap-1 sm:col-span-3 md:col-span-1">
              <label htmlFor={`${uid}-tier`} className="label">Tier</label>
              <select id={`${uid}-tier`} value={tier} onChange={(ev) => state.setTier?.(ev.target.value as BudgetTier)} className="h-9 rounded-sm border border-line-strong bg-bg px-2 text-[13px] text-ink">
                {(Object.keys(BUDGET_TIER_LABEL) as BudgetTier[]).map((t) => (
                  <option key={t} value={t}>{BUDGET_TIER_LABEL[t]}</option>
                ))}
              </select>
            </div>
            {RATE_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label htmlFor={`${uid}-${f.key}`} className="label">{f.label(units)}</label>
                <input id={`${uid}-${f.key}`} type="number" inputMode="decimal" min={0} step={f.step} value={rates[f.key]} onChange={(ev) => state.setRate?.(f.key, Number(ev.target.value))} className="num h-9 rounded-sm border border-line-strong bg-bg px-2 text-[13px] text-ink" />
              </div>
            ))}
          </div>
          {state.edited && (
            <button type="button" onClick={() => state.reset?.()} className="mt-2 rounded-sm text-[13px] font-semibold leading-[18px] text-ink-muted hover:text-ink">
              Reset to {BUDGET_TIER_LABEL[tier]} defaults
            </button>
          )}
        </details>
      ) : (
        <p className="mt-4 text-[13px] leading-[18px] text-ink-muted">
          Assumptions: {BUDGET_TIER_LABEL[tier]} · {rate(rates.perUnit, units)}/{unitLabel} · {money(rates.perDay, units)}/day · {rates.crew} crew · {money(rates.avgTicket, units)} ticket · legs over {formatInt(rates.flightLeg)} {unitLabel} flown.
        </p>
      )}

      {state.room && (
        <p className="mt-3 max-w-[80ch] text-[13px] leading-[18px] text-ink-muted">
          <span className="font-semibold text-ink">Room sizes.</span> {capacityBasis(state.room)}.
        </p>
      )}

      <p className="mt-3 max-w-[80ch] text-xs leading-4 text-ink-faint">
        Planning assumptions, not a full show break-even. Distance and costs are Soundcheck estimates. Road {unitLabel} are straight-line × 1.25. Covers moving the tour and keeping the crew on the road. Venue hire, production and the act&rsquo;s fee are not included; flight legs and hotels are not priced because there is no reliable source for them.
      </p>
    </section>
  );
}
