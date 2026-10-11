import type { Plan } from "@/lib/types";

export interface SketchPoint {
  x: number;
  y: number;
  n?: number;
  r?: number;
}

/** Project lat/lon to 0..1 box coordinates (equirectangular, uniform scale, centred). */
export function projectPlan(plan: Pick<Plan, "stops" | "candidates">): { route: SketchPoint[]; heat: SketchPoint[]; aspect: number } {
  const pts = [...plan.candidates, ...plan.stops.map((s) => s.city)];
  if (!pts.length) return { route: [], heat: [], aspect: 1.6 };
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((latMid * Math.PI) / 180);
  const w = (Math.max(...lons) - Math.min(...lons)) * k || 1;
  const h = Math.max(...lats) - Math.min(...lats) || 1;
  const scale = Math.max(w, h);
  const proj = (lat: number, lon: number) => ({
    x: 0.5 + ((lon - (Math.min(...lons) + Math.max(...lons)) / 2) * k) / scale,
    y: 0.5 - (lat - (Math.min(...lats) + Math.max(...lats)) / 2) / scale,
  });
  return {
    route: plan.stops.map((s) => ({ ...proj(s.city.lat, s.city.lon), n: s.order })),
    heat: plan.candidates.map((c) => ({ ...proj(c.lat, c.lon), r: c.affinity })),
    aspect: w / h,
  };
}

/** Deterministic abstract route for demos whose plan is not on hand. */
export function seededRoute(seed: string, count = 9): SketchPoint[] {
  let a = 0;
  for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({ x: 0.06 + (i / (count - 1)) * 0.88, y: 0.2 + rnd() * 0.6, n: i + 1 }));
}

/**
 * A static sketch of the route: heat dots in signal, the route in spot, numbered stops.
 * Used on the landing cards and the print cover; the interactive map lives in PlanMap.
 */
export function RouteSketch({ route, heat = [], width = 320, height = 160, numbers = false, label, className }: { route: SketchPoint[]; heat?: SketchPoint[]; width?: number; height?: number; numbers?: boolean; label?: string; className?: string }) {
  const pad = numbers ? 22 : 14;
  const px = (v: number) => pad + v * (width - pad * 2);
  const py = (v: number) => pad + v * (height - pad * 2);
  const d = route.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label ?? "Route sketch"} preserveAspectRatio="xMidYMid meet">
      <rect width={width} height={height} fill="var(--bg-sunken)" />
      {heat.map((p, i) => (
        <circle key={i} cx={px(p.x)} cy={py(p.y)} r={3 + (p.r ?? 0.5) * 9} fill="var(--signal)" opacity={0.18 + (p.r ?? 0.5) * 0.3} />
      ))}
      <path d={d} fill="none" stroke="var(--route)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {route.map((p, i) =>
        numbers ? (
          <g key={i}>
            <circle cx={px(p.x)} cy={py(p.y)} r={9} fill="var(--spot)" stroke="var(--bg-sunken)" strokeWidth={2} />
            <text x={px(p.x)} y={py(p.y) + 3.5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fontWeight="500" fill="var(--on-spot)">{p.n}</text>
          </g>
        ) : (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r={3} fill="var(--spot)" />
        ),
      )}
    </svg>
  );
}
