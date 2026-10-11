import type { CityScore } from "@/lib/types";

const W = 200;
const H = 148;
const PAD = { l: 16, r: 8, t: 8, b: 18 };

const dotColor: Record<CityScore["quadrant"], string> = {
  untapped: "var(--quadrant-untapped)",
  established: "var(--quadrant-established)",
  reach: "var(--quadrant-reach)",
};

/**
 * A 200px affinity-against-popularity scatter of every candidate, with the current city ringed.
 * Pure SVG: the ring glides between dots with a CSS transform transition (see .tq-ring in tour.css).
 */
export function MiniQuadrant({ candidates, currentId, className }: { candidates: CityScore[]; currentId?: string; className?: string }) {
  const affs = candidates.map((c) => c.affinity);
  const lo = Math.max(0, Math.min(...affs, 0.4) - 0.05);
  const hi = 1;
  const x = (pop: number) => PAD.l + pop * (W - PAD.l - PAD.r);
  const y = (aff: number) => PAD.t + (1 - (aff - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  // Horizontal split sits between the weakest recommended market and the strongest "reach" one.
  const reach = candidates.filter((c) => c.quadrant === "reach").map((c) => c.affinity);
  const strong = candidates.filter((c) => c.quadrant !== "reach").map((c) => c.affinity);
  const splitAff = reach.length && strong.length ? (Math.max(...reach) + Math.min(...strong)) / 2 : (lo + hi) / 2;
  const splitX = x(0.5);
  const splitY = y(splitAff);

  const current = candidates.find((c) => c.id === currentId);
  const cx = current ? x(current.popularity) : 0;
  const cy = current ? y(current.affinity) : 0;
  const labelRight = cx < W * 0.6;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`Affinity against popularity for ${candidates.length} candidate cities${current ? `, ${current.name} highlighted` : ""}`}
    >
      <rect x={PAD.l} y={PAD.t} width={splitX - PAD.l} height={splitY - PAD.t} fill="var(--signal-soft)" />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--line-strong)" />
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--line-strong)" />
      <line x1={splitX} y1={PAD.t} x2={splitX} y2={H - PAD.b} stroke="var(--line)" strokeDasharray="3 3" />
      <line x1={PAD.l} y1={splitY} x2={W - PAD.r} y2={splitY} stroke="var(--line)" strokeDasharray="3 3" />
      <text x={PAD.l + 4} y={PAD.t + 11} fill="var(--signal)" fontSize="8" fontWeight="600" letterSpacing="0.08em">
        PRIMED, UNTAPPED
      </text>
      <text x={W - PAD.r} y={H - 4} textAnchor="end" fill="var(--ink-muted)" fontSize="9" style={{ fontFamily: "var(--font-plex-mono), ui-monospace, monospace" }}>
        popularity →
      </text>
      <text x={10} y={H - PAD.b} fill="var(--ink-muted)" fontSize="9" transform={`rotate(-90 10 ${H - PAD.b})`} style={{ fontFamily: "var(--font-plex-mono), ui-monospace, monospace" }}>
        affinity →
      </text>
      {candidates.map((c) => (
        <circle key={c.id} cx={x(c.popularity)} cy={y(c.affinity)} r={c.quadrant === "reach" ? 2.5 : 3.5} fill={dotColor[c.quadrant]} />
      ))}
      <g className="tq-ring" style={{ transform: `translate(${cx}px, ${cy}px)`, opacity: current ? 1 : 0 }}>
        <circle r="7.5" fill="none" stroke="var(--signal)" strokeWidth="1.5" />
        <text x={labelRight ? 11 : -11} y={3.5} textAnchor={labelRight ? "start" : "end"} fill="var(--ink)" fontSize="10" stroke="var(--bg-raised)" strokeWidth="3" paintOrder="stroke">
          {current?.name}
        </text>
      </g>
    </svg>
  );
}
