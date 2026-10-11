/**
 * Easing curves that mirror the design system's CSS custom properties, so JS-driven motion
 * (route draw, count-up, bloom) matches the CSS transitions exactly.
 */

/** Solve a CSS-style cubic-bezier(x1, y1, x2, y2) for y at x. Newton-Raphson with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (hi - lo) / 2 + lo;
      if (hi - lo < 1e-7) break;
    }
    return t;
  };

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}

/** --ease-out: anything entering. */
export const easeOut = cubicBezier(0.16, 1, 0.3, 1);
/** --ease-in-out: anything travelling (camera, route, ring). */
export const easeInOut = cubicBezier(0.65, 0, 0.35, 1);
/** --ease-spring: the stop marker landing pulse only. */
export const easeSpring = cubicBezier(0.34, 1.56, 0.64, 1);

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
