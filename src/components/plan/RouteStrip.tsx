"use client";

import type { Stop } from "@/lib/types";
import { MarketBadge } from "@/components/ui/MarketBadge";
import { StopMarker } from "@/components/ui/StopMarker";
import { cn } from "@/components/ui/cn";
import { totalLegDays } from "./format";

interface Props {
  stops: Stop[];
  selectedStop?: number;
  hoveredStop?: number;
  onSelectStop?: (order: number) => void;
  onHoverStop?: (order: number | undefined) => void;
  /** The route draws over 600ms on mount. Off for print. */
  animate?: boolean;
  /** Print view: plain spans, no buttons. */
  interactive?: boolean;
  className?: string;
}

/** Numbered stops with travel-day gaps. Clicking a stop scrolls to its card (handled by the parent). */
export function RouteStrip({ stops, selectedStop, hoveredStop, onSelectStop, onHoverStop, animate = true, interactive = true, className }: Props) {
  const n = stops.length;
  const legMs = n > 1 ? Math.round(600 / (n - 1)) : 600;
  return (
    <section className={cn("rounded-md border border-line bg-bg-raised p-4 sm:p-5", className)} aria-labelledby="route-title">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="route-title" className="font-display text-[26px] font-semibold leading-7">Route</h2>
        <p className="text-[13px] leading-[18px] text-ink-muted">
          {n} stops · <span className="num">{totalLegDays(stops)}</span> travel days
        </p>
      </div>
      <ol className="flex flex-wrap items-center gap-y-2">
        {stops.map((s, i) => {
          const sel = selectedStop === s.order;
          const hov = hoveredStop === s.order;
          const body = (
            <>
              <StopMarker n={s.order} size={22} />
              <span className="font-display text-lg font-semibold uppercase leading-5 tracking-[0.01em]">{s.city.name}</span>
              {s.city.quadrant === "untapped" && <MarketBadge quadrant="untapped" size="sm" />}
            </>
          );
          const cls = cn(
            "sc-link flex items-center gap-2 whitespace-nowrap rounded-md border py-1.5 pl-1.5 pr-2.5 text-left",
            sel ? "border-spot bg-spot-soft" : hov ? "border-line-strong bg-bg-raised" : "border-line bg-bg-raised",
          );
          return (
            <li key={s.order} className="flex items-center">
              {i > 0 && (
                <span className="flex flex-none items-center px-2 text-xs leading-4 text-ink-muted">
                  <span
                    aria-hidden="true"
                    className={cn("mr-1 inline-block h-0.5 w-4 bg-spot", animate && "sc-leg")}
                    style={animate ? { ["--sc-delay" as string]: `${(i - 1) * legMs}ms`, ["--sc-dur" as string]: `${legMs}ms` } : undefined}
                  />
                  <span className="num">
                    {s.legDays}d<span className="sr-only"> travel</span>
                  </span>
                </span>
              )}
              {interactive ? (
                <button
                  type="button"
                  className={cn(cls, "cursor-pointer")}
                  aria-label={`Stop ${s.order}, ${s.city.name}. Go to city card.`}
                  aria-current={sel ? "true" : undefined}
                  onClick={() => onSelectStop?.(s.order)}
                  onPointerEnter={() => onHoverStop?.(s.order)}
                  onPointerLeave={() => onHoverStop?.(undefined)}
                  onFocus={() => onHoverStop?.(s.order)}
                  onBlur={() => onHoverStop?.(undefined)}
                >
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
