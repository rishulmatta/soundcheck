"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MONTH_LONG, MONTH_SHORT, formatWindow, orderRange, sameYearMonth, ymIndex, type MonthRange, type YearMonth } from "@/lib/window";
import { cn } from "./cn";
import { Calendar, ChevronLeft, ChevronRight } from "./icons";
import "./motion.css";

const YEARS_AHEAD = 3;

/**
 * A month-range picker for the touring window. Day-level dates would promise a schedule the planner never checks,
 * so the unit is the month: click a start month, click an end month. Writes back the stored prose ("Jan–Mar 2027").
 *
 * `text` is the stored string when it cannot be parsed into months (a hand-written "next fall"); the trigger shows it
 * as is until the user picks months, so nothing a model proposed is silently lost.
 */
export function MonthRangePicker({
  id,
  value,
  text,
  onChange,
  side = "bottom",
  placeholder = "Any time",
  className,
}: {
  id: string;
  value: MonthRange | undefined;
  text?: string;
  onChange: (range: MonthRange | undefined) => void;
  side?: "bottom" | "top";
  placeholder?: string;
  /** The field classes of the surrounding form, so the trigger lines up with its neighbours. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(0);
  // Read at open time, never during render: this page prerenders and the current date is not a stable value.
  const [bounds, setBounds] = useState({ min: 0, max: 0 });
  const [anchor, setAnchor] = useState<YearMonth | undefined>();
  const [hover, setHover] = useState<YearMonth | undefined>();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  function show() {
    const thisYear = new Date().getFullYear();
    setBounds({ min: Math.min(thisYear, value?.start.year ?? thisYear), max: Math.max(thisYear + YEARS_AHEAD, value?.end.year ?? thisYear) });
    setYear(value?.start.year ?? thisYear);
    setAnchor(undefined);
    setHover(undefined);
    setOpen(true);
  }

  function hide(refocus = false) {
    setOpen(false);
    setAnchor(undefined);
    setHover(undefined);
    if (refocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide(true);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    const focusTarget = grid.current?.querySelector<HTMLButtonElement>("[data-start=true]") ?? grid.current?.querySelector<HTMLButtonElement>("button");
    focusTarget?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // Runs once per open; the selection moves focus itself.
  }, [open]);

  function pick(ym: YearMonth) {
    if (!anchor) {
      setAnchor(ym);
      onChange({ start: ym, end: ym });
      return;
    }
    onChange(orderRange(anchor, ym));
    hide(true);
  }

  // What the grid paints: the live preview while a second month is being chosen, else the committed value.
  const shown: MonthRange | undefined = anchor ? orderRange(anchor, hover ?? anchor) : value;
  const lo = shown ? ymIndex(shown.start) : NaN;
  const hi = shown ? ymIndex(shown.end) : NaN;

  const label = value ? formatWindow(value) : text?.trim() || "";

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => (open ? hide() : show())}
        className={cn(className, "flex items-center justify-between gap-2 text-left aria-expanded:border-ink-muted")}
      >
        <span className={cn("truncate", !label && "text-ink-faint")}>{label || placeholder}</span>
        <span className="shrink-0 text-ink-muted"><Calendar /></span>
      </button>
      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label="Touring window"
          className={cn(
            "sc-popover absolute left-0 z-30 w-[min(17rem,calc(100vw-2rem))] rounded-md border border-line-strong bg-bg-raised p-3 shadow-popover",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous year"
              disabled={year <= bounds.min}
              onClick={() => setYear((y) => y - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-bg-sunken hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft />
            </button>
            <span aria-live="polite" className="num text-[15px] font-semibold leading-[22px] text-ink">{year}</span>
            <button
              type="button"
              aria-label="Next year"
              disabled={year >= bounds.max}
              onClick={() => setYear((y) => y + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-bg-sunken hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight />
            </button>
          </div>
          <div ref={grid} role="group" aria-label={`Months of ${year}`} className="grid grid-cols-4 gap-1" onPointerLeave={() => setHover(undefined)}>
            {MONTH_SHORT.map((m, month) => {
              const ym = { year, month };
              const i = ymIndex(ym);
              const inRange = i >= lo && i <= hi;
              const isStart = shown ? sameYearMonth(ym, shown.start) : false;
              const isEnd = shown ? sameYearMonth(ym, shown.end) : false;
              const edge = isStart || isEnd;
              return (
                <button
                  key={m}
                  type="button"
                  data-start={isStart || undefined}
                  aria-label={`${MONTH_LONG[month]} ${year}`}
                  aria-pressed={inRange}
                  onClick={() => pick(ym)}
                  onPointerEnter={() => anchor && setHover(ym)}
                  onFocus={() => anchor && setHover(ym)}
                  className={cn(
                    "h-9 rounded-sm text-[13px] font-semibold leading-[18px] transition-colors duration-150",
                    edge ? "bg-spot text-on-spot" : inRange ? "bg-spot-soft text-ink" : "text-ink hover:bg-bg-sunken",
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[13px] leading-[18px] text-ink-muted">
              {anchor && !hover ? "Now pick the last month" : shown ? formatWindow(shown) : "Pick the first month"}
            </p>
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                hide(true);
              }}
              className="shrink-0 rounded-sm px-1 text-[13px] font-semibold leading-[18px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
