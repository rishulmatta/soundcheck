"use client";
import { useEffect, useRef } from "react";
import type { Stop } from "@/lib/types";
import type { TourController } from "@/lib/tour/sequencer";

const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

export interface TourControlsProps {
  stops: Stop[];
  /** Current stop index; equals stops.length in the finale. */
  index: number;
  playing: boolean;
  controller: TourController | null;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  onSeek: (index: number) => void;
}

/**
 * Previous, play/pause with a spot progress ring, next, one dot per stop, and "Stop n of N".
 * The ring is written straight to the DOM from the sequencer's tick, so it follows the same clock as the cues
 * and freezes exactly when the tour pauses.
 */
export function TourControls({ stops, index, playing, controller, onPrev, onNext, onToggle, onSeek }: TourControlsProps) {
  const ringRef = useRef<SVGCircleElement>(null);
  const finale = index >= stops.length;

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring || !controller) return;
    const paint = (progress: number) => {
      ring.style.strokeDashoffset = String(RING_C * (1 - progress));
    };
    paint(controller.state().finale ? 1 : 0);
    return controller.subscribeTick((e) => paint(e.progress));
  }, [controller]);

  return (
    <div
      className="pointer-events-auto flex w-max max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-md border border-line bg-bg-raised py-2 pl-2 pr-4 sm:rounded-full"
      role="group"
      aria-label="Tour controls"
    >
      <button type="button" className="tc-ib grid size-9 place-items-center rounded-full border border-line-strong text-xl leading-none text-ink" aria-label="Previous stop" onClick={onPrev}>
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        className="tc-ib grid size-9 place-items-center rounded-full"
        aria-label={playing ? "Pause tour" : finale ? "Replay tour" : "Play tour"}
        onClick={onToggle}
      >
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            ref={ringRef}
            cx="18"
            cy="18"
            r={RING_R}
            fill="none"
            stroke="var(--spot)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C}
            transform="rotate(-90 18 18)"
          />
          {playing ? (
            <>
              <rect x="12" y="11" width="4" height="14" fill="var(--ink)" />
              <rect x="20" y="11" width="4" height="14" fill="var(--ink)" />
            </>
          ) : (
            <path d="M14 11.5v13l11-6.5z" fill="var(--ink)" />
          )}
        </svg>
      </button>
      <button type="button" className="tc-ib grid size-9 place-items-center rounded-full border border-line-strong text-xl leading-none text-ink" aria-label="Next stop" onClick={onNext}>
        <span aria-hidden="true">›</span>
      </button>

      <ol className="order-last m-0 flex w-full list-none justify-center gap-0.5 p-0 sm:order-none sm:w-auto sm:px-1" aria-label="Stops">
        {stops.map((s, i) => (
          <li key={s.order} className="flex">
            <button
              type="button"
              className="grid size-4 place-items-center"
              aria-label={`Go to stop ${s.order}, ${s.city.name}`}
              aria-current={i === index ? "step" : undefined}
              onClick={() => onSeek(i)}
            >
              <span className="tc-dot" data-state={i < index ? "done" : i === index ? "cur" : "todo"} data-untapped={s.city.quadrant === "untapped" ? "true" : "false"} />
            </button>
          </li>
        ))}
      </ol>

      <span className="num min-w-[88px] text-xs text-ink-muted" aria-live="off">
        {finale ? "Finale" : `Stop ${index + 1} of ${stops.length}`}
      </span>
    </div>
  );
}
