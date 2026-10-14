"use client";

import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import type { CityScore, PlanProvenance, Quadrant, Stop } from "@/lib/types";
import { AFFINITY_GATE, UNTAPPED_GAP } from "@/lib/score";
import { QlooTag } from "@/components/ui/QlooTag";
import { cn } from "@/components/ui/cn";
import { stagger } from "@/components/ui/stagger";

const W = 440;
const H = 320;
const M = { top: 14, right: 14, bottom: 38, left: 46 };

const FILL: Record<Quadrant, string> = {
  untapped: "var(--quadrant-untapped)",
  established: "var(--quadrant-established)",
  reach: "var(--quadrant-reach)",
};

/** Where the cell boundaries fall, read from how the candidates were classified; falls back to sane midpoints. */
function splits(c: CityScore[]): { pop: number; aff: number } {
  const by = (q: Quadrant) => c.filter((x) => x.quadrant === q);
  const un = by("untapped");
  const es = by("established");
  const re = by("reach");
  const mid = (a: number | undefined, b: number | undefined, fallback: number) => (a !== undefined && b !== undefined ? (a + b) / 2 : fallback);
  const pop = mid(un.length ? Math.max(...un.map((x) => x.popularity)) : undefined, es.length ? Math.min(...es.map((x) => x.popularity)) : undefined, 0.5);
  const hi = [...un, ...es];
  const aff = mid(re.length ? Math.max(...re.map((x) => x.affinity)) : undefined, hi.length ? Math.min(...hi.map((x) => x.affinity)) : undefined, 0.6);
  return { pop, aff };
}

interface Props {
  candidates: CityScore[];
  stops?: Stop[];
  /** 1-based stop order that is hovered or selected (shared state). */
  activeStop?: number;
  /** True when the active stop is a sticky selection (adds the glow). */
  selected?: boolean;
  onHoverStop?: (order: number | undefined) => void;
  onSelectStop?: (order: number) => void;
  /** Dots land one by one on mount. Off for the print view. */
  animate?: boolean;
  /** Draw the surrounding panel (title and border). */
  panel?: boolean;
  /**
   * The plan's heatmap comparability (provenanceFor(plan).heatmapComparability). "region-normalized" plans draw the
   * scorer's real boundaries: the affinity gate and the affinity = popularity + gap diagonal. "unverified" plans (the
   * saved demos, classified under the earlier rule) keep the split read from how their candidates were classified.
   */
  comparability?: PlanProvenance["heatmapComparability"];
  className?: string;
}

export function QuadrantChart({ candidates, stops = [], activeStop, selected = false, onHoverStop, onSelectStop, animate = true, panel = true, comparability = "unverified", className }: Props) {
  const [localHover, setLocalHover] = useState<string | undefined>();
  const diagonal = comparability === "region-normalized";
  const x = useMemo(() => scaleLinear().domain([0, 1]).range([M.left, W - M.right]), []);
  // The y axis starts just under the lowest affinity so the cells are not squashed into the top third. With the
  // diagonal boundary it never starts above 0.4, so the affinity gate (and the reach band under it) stays visible.
  const yLo = useMemo(() => {
    const lo = Math.max(0, Math.floor((Math.min(...candidates.map((c) => c.affinity), 1) - 0.08) * 10) / 10);
    return diagonal ? Math.min(lo, AFFINITY_GATE - 0.1) : lo;
  }, [candidates, diagonal]);
  const y = useMemo(() => scaleLinear().domain([yLo, 1.04]).range([H - M.bottom, M.top]), [yLo]);
  const cut = useMemo(() => splits(candidates), [candidates]);
  const orderById = useMemo(() => new Map(stops.map((s) => [s.city.id, s.order])), [stops]);
  const activeId = activeStop !== undefined ? stops.find((s) => s.order === activeStop)?.city.id : localHover;

  const sx = x(cut.pop);
  const sy = y(cut.aff);
  const untappedCount = candidates.filter((c) => c.quadrant === "untapped").length;

  // Region-normalized boundary: untapped is affinity >= gate and affinity - popularity >= gap, i.e. above the gate
  // line and left of the diagonal affinity = popularity + gap. The diagonal runs from the gate to the right edge.
  const yTop = y.domain()[1];
  const gateY = y(AFFINITY_GATE);
  const diagStart = { x: x(AFFINITY_GATE - UNTAPPED_GAP), y: gateY };
  const diagEnd = { x: x(1), y: y(Math.min(yTop, 1 + UNTAPPED_GAP)) };
  const untappedArea = [
    [M.left, gateY],
    [diagStart.x, diagStart.y],
    [diagEnd.x, diagEnd.y],
    [x(1), y(yTop)],
    [M.left, y(yTop)],
  ].map((p) => p.join(",")).join(" ");

  // Draw order: reach, established, untapped, so the interesting dots sit on top.
  const rank: Record<Quadrant, number> = { reach: 0, established: 1, untapped: 2 };
  const ordered = useMemo(() => [...candidates].sort((a, b) => rank[a.quadrant] - rank[b.quadrant]), [candidates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels: the active dot first, then untapped, then other routed stops; skip any that would collide.
  const labels = useMemo(() => {
    const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    const out = new Map<string, { x: number; y: number; anchor: "start" | "end" }>();
    const priority = (c: CityScore) => (c.id === activeId ? 0 : c.quadrant === "untapped" ? 1 : orderById.has(c.id) ? 2 : 9);
    const wanted = [...candidates].filter((c) => priority(c) < 9).sort((a, b) => priority(a) - priority(b) || b.affinity - a.affinity);
    for (const c of wanted) {
      const w = c.name.length * 6.4;
      const cx = x(c.popularity);
      const cy = y(c.affinity);
      const flip = cx + 10 + w > W - M.right;
      const x0 = flip ? cx - 10 - w : cx + 10;
      const box = { x0, x1: x0 + w, y0: cy - 7, y1: cy + 7 };
      const hit = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      if (hit && c.id !== activeId) continue;
      placed.push(box);
      out.set(c.id, { x: flip ? cx - 10 : cx + 10, y: cy + 4, anchor: flip ? "end" : "start" });
    }
    return out;
  }, [candidates, activeId, orderById, x, y]);

  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={
      diagonal
        ? `Affinity against popularity for ${candidates.length} candidate cities from one region-wide heatmap. ${untappedCount} are primed and less known than their fit suggests.`
        : `Affinity against popularity for ${candidates.length} candidate cities. ${untappedCount} have higher affinity with lower popularity. Cross-city comparisons are provisional.`
    }>
      {/* Highlighted ground fades in first. */}
      {diagonal ? (
        <polygon points={untappedArea} fill="var(--signal-soft)" className={animate ? "sc-fade" : undefined} />
      ) : (
        <rect x={M.left} y={M.top} width={sx - M.left} height={sy - M.top} fill="var(--signal-soft)" className={animate ? "sc-fade" : undefined} />
      )}
      <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} stroke="var(--line-strong)" />
      <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} stroke="var(--line-strong)" />
      {diagonal ? (
        <>
          <line x1={M.left} y1={gateY} x2={W - M.right} y2={gateY} stroke="var(--line)" strokeDasharray="3 3" />
          <line x1={diagStart.x} y1={diagStart.y} x2={diagEnd.x} y2={diagEnd.y} stroke="var(--line)" strokeDasharray="3 3" />
        </>
      ) : (
        <>
          <line x1={sx} y1={M.top} x2={sx} y2={H - M.bottom} stroke="var(--line)" strokeDasharray="3 3" />
          <line x1={M.left} y1={sy} x2={W - M.right} y2={sy} stroke="var(--line)" strokeDasharray="3 3" />
        </>
      )}

      {[0, 0.5, 1].map((t) => (
        <text key={`x${t}`} x={x(t)} y={H - M.bottom + 14} textAnchor="middle" className="num" fontSize="11" fill="var(--ink-muted)">{t === 0 ? "0" : t.toFixed(1)}</text>
      ))}
      {(diagonal ? [0.2, 0.4, AFFINITY_GATE, 0.6, 0.8, 1] : [0.2, 0.4, 0.6, 0.8, 1]).filter((t) => t >= yLo + 0.05).map((t) => (
        <text key={`y${t}`} x={M.left - 6} y={y(t) + 4} textAnchor="end" className="num" fontSize="11" fill="var(--ink-muted)">{t.toFixed(1)}</text>
      ))}

      <g fontFamily="var(--font-sans)" fontSize="10" fontWeight="600" letterSpacing="0.08em">
        {diagonal ? (
          <>
            <text x={M.left + 8} y={M.top + 16} fill="var(--signal)">INVESTIGATE</text>
            <text x={W - M.right - 8} y={gateY - 8} textAnchor="end" fill="var(--ink-muted)">HIGHER SIGNALS</text>
            <text x={M.left + 8} y={H - M.bottom - 8} fill="var(--ink-faint)">LOWER AFFINITY</text>
          </>
        ) : (
          <>
            <text x={M.left + 8} y={M.top + 16} fill="var(--signal)">INVESTIGATE</text>
            <text x={sx + 8} y={M.top + 16} fill="var(--ink-muted)">HIGHER SIGNALS</text>
            <text x={M.left + 8} y={H - M.bottom - 8} fill="var(--ink-faint)">LOWER AFFINITY</text>
            <text x={sx + 8} y={H - M.bottom - 8} fill="var(--ink-faint)">LOWER AFFINITY</text>
          </>
        )}
      </g>
      <text x={W - M.right} y={H - 6} textAnchor="end" className="num" fontSize="11" fill="var(--ink-muted)">popularity →</text>
      <text transform={`rotate(-90 12 ${M.top})`} x={12} y={M.top} textAnchor="end" className="num" fontSize="11" fill="var(--ink-muted)">affinity →</text>

      {ordered.map((c, i) => {
        const order = orderById.get(c.id);
        const isActive = c.id === activeId;
        const r = c.quadrant === "reach" ? 4 : 5;
        const cx = x(c.popularity);
        const cy = y(c.affinity);
        const label = labels.get(c.id) ?? (isActive ? { x: cx + 10, y: cy + 4, anchor: "start" as const } : undefined);
        const interactive = order !== undefined;
        return (
          <g
            key={c.id}
            {...(interactive
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${c.name}, stop ${order}. Affinity ${c.affinity.toFixed(2)}, popularity ${c.popularity.toFixed(2)}.`,
                  "aria-pressed": selected && activeStop === order,
                  onClick: () => onSelectStop?.(order),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectStop?.(order);
                    }
                  },
                  onFocus: () => onHoverStop?.(order),
                  onBlur: () => onHoverStop?.(undefined),
                }
              : { "aria-hidden": true })}
            onPointerEnter={() => (interactive ? onHoverStop?.(order) : setLocalHover(c.id))}
            onPointerLeave={() => (interactive ? onHoverStop?.(undefined) : setLocalHover(undefined))}
            style={{ cursor: interactive ? "pointer" : "default", outline: "none" }}
          >
            <circle cx={cx} cy={cy} r={13} fill="transparent" />
            <circle
              className="ring sc-link"
              cx={cx}
              cy={cy}
              r={r + 4.5}
              fill="none"
              stroke="var(--signal)"
              strokeWidth={1.5}
              style={{ opacity: isActive ? 1 : 0, filter: isActive && selected ? "drop-shadow(0 0 6px var(--signal-glow))" : undefined }}
            />
            <circle
              className={cn(animate && "sc-dot")}
              cx={cx}
              cy={cy}
              r={r}
              fill={FILL[c.quadrant]}
              style={animate ? stagger(i, 40, 220) : undefined}
            />
            {label && (
              <text
                x={label.x}
                y={label.y}
                textAnchor={label.anchor}
                fontFamily="var(--font-sans)"
                fontSize="12"
                fontWeight={isActive ? 600 : 500}
                fill={isActive || c.quadrant === "untapped" ? "var(--ink)" : "var(--ink-muted)"}
                style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "var(--bg-raised)", strokeWidth: 3, strokeLinejoin: "round" }}
                className={animate ? "sc-fade" : undefined}
              >
                {c.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );

  if (!panel) return <div className={className}>{svg}</div>;
  return (
    <section className={cn("rounded-md border border-line bg-bg-raised p-4 sm:p-5", className)} aria-labelledby="quadrant-title">
      <div className="mb-2 flex items-center gap-2.5">
        <h2 id="quadrant-title" className="font-display text-[26px] font-semibold leading-7">Markets to investigate</h2>
        <QlooTag />
      </div>
      <p className="mb-3 text-[13px] leading-[18px] text-ink-muted">
        {diagonal
          ? `${candidates.length} cities from one region-wide Qloo heatmap. Above the dashed line the taste is primed for the act; left of the diagonal it is less known than that fit suggests. No booking history is available.`
          : `${candidates.length} cities, with provisional affinity and popularity scores. Top left means higher affinity and lower popularity; no booking history is available.`}
      </p>
      {svg}
    </section>
  );
}
