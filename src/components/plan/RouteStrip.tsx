"use client";

import { useId, useState } from "react";
import type { Stop } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, ArrowRight, GripVertical, Undo } from "@/components/ui/icons";
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
  /** When set the stops can be reordered by drag or Alt+Arrow keys; called with the new city-id order. */
  onReorder?: (cityIds: string[]) => void;
  /** The order differs from the router's: shows "Reordered by hand" and the reset button. */
  reordered?: boolean;
  /** Clears the manual order. */
  onResetOrder?: () => void;
  className?: string;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Numbered stops with travel-day gaps. Clicking a stop scrolls to its card (handled by the parent). */
export function RouteStrip({ stops, selectedStop, hoveredStop, onSelectStop, onHoverStop, animate = true, interactive = true, onReorder, reordered = false, onResetOrder, className }: Props) {
  const n = stops.length;
  const hintId = useId();
  const canReorder = interactive && Boolean(onReorder);
  const [dragFrom, setDragFrom] = useState<number | undefined>();
  const [dragOver, setDragOver] = useState<number | undefined>();
  const [announce, setAnnounce] = useState("");

  const commit = (from: number, to: number) => {
    if (!onReorder || from === to || to < 0 || to >= n) return;
    const next = move(stops, from, to);
    onReorder(next.map((s) => s.city.id));
    setAnnounce(`Moved ${stops[from].city.name} to position ${to + 1} of ${n}.`);
  };
  const onKeyMove = (e: React.KeyboardEvent, i: number) => {
    if (!canReorder || !e.altKey) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      commit(i, i - 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      commit(i, i + 1);
    }
  };

  const legMs = n > 1 ? Math.round(600 / (n - 1)) : 600;
  return (
    <section className={cn("rounded-md border border-line bg-bg-raised p-4 sm:p-5", className)} aria-labelledby="route-title">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="route-title" className="font-display text-[26px] font-semibold leading-7">Route</h2>
        <p className="text-[13px] leading-[18px] text-ink-muted">
          {n} stops · <span className="num">{totalLegDays(stops)}</span> travel days
        </p>
        {canReorder && (
          <>
            <p id={hintId} className="text-[13px] leading-[18px] text-ink-faint">
              Drag a stop by its handle to reorder. With a stop focused, press Alt and an arrow key to move it.
            </p>
            {reordered && (
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex h-[22px] items-center rounded-full bg-spot-soft px-2.5 font-mono text-xs font-medium leading-4 text-spot">Reordered by hand</span>
                {onResetOrder && (
                  <Button variant="ghost" size="sm" icon={<Undo />} onClick={onResetOrder} title="Back to the route Soundcheck chose">
                    Re-route
                  </Button>
                )}
              </span>
            )}
          </>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
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
            <li
              key={s.city.id}
              data-stop-index={i}
              className={cn("flex items-center rounded-md", canReorder && dragFrom !== undefined && dragOver === i && dragFrom !== i && "shadow-[inset_2px_0_0_var(--spot)]", canReorder && dragFrom === i && "opacity-50")}
              onDragOver={canReorder ? (e) => { if (dragFrom === undefined) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== i) setDragOver(i); } : undefined}
              onDrop={canReorder ? (e) => { e.preventDefault(); if (dragFrom !== undefined) commit(dragFrom, i); setDragFrom(undefined); setDragOver(undefined); } : undefined}
            >
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
                <div className="flex items-center">
                {canReorder && (
                  <span
                    draggable
                    aria-hidden="true"
                    title="Drag to reorder"
                    className="-mr-1 flex h-8 w-5 flex-none cursor-grab items-center justify-center text-ink-faint hover:text-ink active:cursor-grabbing"
                    onDragStart={(e) => {
                      setDragFrom(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", s.city.id);
                      const li = (e.currentTarget as HTMLElement).closest("li");
                      if (li) e.dataTransfer.setDragImage(li, 12, 16);
                    }}
                    onDragEnd={() => { setDragFrom(undefined); setDragOver(undefined); }}
                  >
                    <GripVertical size={16} />
                  </span>
                )}
                <button
                  type="button"
                  className={cn(cls, "cursor-pointer")}
                  aria-describedby={canReorder ? hintId : undefined}
                  onKeyDown={(e) => onKeyMove(e, i)}
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
                {canReorder && sel && (
                  <span className="ml-1 hidden items-center [@media(pointer:coarse)]:inline-flex">
                    <Button variant="ghost" size="sm" aria-label={`Move ${s.city.name} earlier`} disabled={i === 0} icon={<ArrowLeft />} className="px-1.5!" onClick={() => commit(i, i - 1)} />
                    <Button variant="ghost" size="sm" aria-label={`Move ${s.city.name} later`} disabled={i === n - 1} icon={<ArrowRight />} className="px-1.5!" onClick={() => commit(i, i + 1)} />
                  </span>
                )}
                </div>
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
