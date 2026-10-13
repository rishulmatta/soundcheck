"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import type { Plan, Stop } from "@/lib/types";
import { safeStopCopy } from "@/lib/provenance";
import { easeOut } from "@/lib/tour/ease";
import { MarketBadge } from "@/components/ui/MarketBadge";
import { QlooTag } from "@/components/ui/QlooTag";
import { StopMarker } from "@/components/ui/StopMarker";
import { genderSkew, splitFigures, strongestBucket } from "./format";

/** Where the card is in its entrance: drives the CSS transitions in tour.css through data-phase. */
export type CardPhase = "hidden" | "out" | "card" | "detail" | "hold";

export const COUNT_UP_MS = 500;

const rowStyle = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * One glance at one stop: the compact CityCard for the tour. It never animates by itself; TourView sets `phase`
 * from the sequencer (card in at 1600 ms, bar and rows at 2200 ms) and tour.css does the moving.
 * The only JS motion is the affinity count-up, written straight to the DOM so no React render happens per frame.
 */
export function TourCard({ plan, stop, pool, phase, reducedMotion }: { plan: Plan; stop: Stop; pool: number; phase: CardPhase; reducedMotion: boolean }) {
  const { city } = stop;
  const copy = safeStopCopy(plan, stop);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    const final = city.affinity.toFixed(2);
    if (phase === "hidden" || phase === "out") {
      el.textContent = "0.00";
      return;
    }
    if (phase !== "card" || reducedMotion) {
      el.textContent = final;
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / COUNT_UP_MS);
      el.textContent = (city.affinity * easeOut(p)).toFixed(2);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, city.affinity, stop.order, reducedMotion]);

  const bucket = strongestBucket(stop.demographics);
  const opener = stop.openers[0];
  const sponsor = stop.sponsors[0];
  let row = 0;

  return (
    <article
      className="tc-card w-full rounded-md border border-line bg-bg-raised px-5 py-4 sm:w-[380px]"
      data-phase={phase}
      aria-label={`Stop ${stop.order}, ${city.name}`}
      aria-hidden={phase === "hidden" || phase === "out" ? true : undefined}
    >
      <header className="mb-2.5 flex items-center gap-2.5">
        <StopMarker n={stop.order} size={24} />
        <h2 className="disp m-0 text-[32px] leading-8">{city.name}</h2>
        <MarketBadge quadrant={city.quadrant} size="sm" className="ml-auto" />
      </header>

      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="label flex items-center gap-1.5">
          Affinity <QlooTag />
        </span>
        <span ref={valueRef} className="num min-w-16 text-[28px] font-medium leading-8 text-signal">
          0.00
        </span>
        <span className="num whitespace-nowrap text-[11px] text-ink-muted">
          provisional {city.affinityRank}/{pool} · pop {city.popularity.toFixed(2)}
        </span>
      </div>

      {bucket && <p className="mb-1 text-[11px] text-ink-muted">Overall audience · act-wide, not city-specific</p>}
      {bucket && (
        <div className="mb-2.5 grid grid-cols-[48px_1fr_auto_auto] items-center gap-2">
          <span className="num text-xs text-ink-muted">{bucket.label}</span>
          <span className="block h-1.5 overflow-hidden rounded-sm bg-line">
            <span className="tc-fill block h-full rounded-sm bg-signal" style={{ width: `${Math.round(Math.max(0, Math.min(1, bucket.score)) * 100)}%` }} />
          </span>
          <span className="num text-xs text-ink-muted">
            {bucket.score >= 0 ? "+" : ""}
            {bucket.score.toFixed(2)}
          </span>
          <span className="text-xs text-ink-muted">{genderSkew(stop.demographics)}</span>
        </div>
      )}

      <div>
        {opener && (
          <div className="tc-row flex items-baseline gap-3 py-1 text-[13px] leading-[18px]" style={rowStyle(row++)}>
            <span className="label w-14 shrink-0">Opener</span>
            <span>
              {opener.name}
              {opener.tasteSimilarity !== undefined && <span className="num ml-2 text-xs text-ink-muted">derived taste similarity {opener.tasteSimilarity.toFixed(2)}</span>}
            </span>
          </div>
        )}
        {sponsor && (
          <div className="tc-row flex items-baseline gap-3 py-1 text-[13px] leading-[18px]" style={rowStyle(row++)}>
            <span className="label w-14 shrink-0">Sponsor</span>
            <span>{sponsor.name}</span>
          </div>
        )}
        <p className="tc-row m-0 mt-1 border-t border-line pt-2 text-[13px] leading-[18px]" style={rowStyle(row++)}>
          {splitFigures(copy.whyHere).map((part, i) =>
            part.figure ? (
              <span key={i} className="num">
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </div>
    </article>
  );
}
