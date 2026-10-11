"use client";

import "./motion.css";
import { useEffect, useRef, useState } from "react";

export { stagger } from "./stagger";

/** True when the user asks for less motion. Only call from effects or handlers. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fires once when the element scrolls into view (or immediately where IntersectionObserver is missing). */
export function useInView<T extends Element>(enabled = true): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!enabled || seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, seen]);
  return [ref, !enabled || seen];
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** Counts from 0 to `target` in 500ms (ease-out). Returns the final value at once when disabled or reduced motion. */
export function useCountUp(target: number, play: boolean, opts: { enabled?: boolean; duration?: number } = {}): number {
  const { enabled = true, duration = 500 } = opts;
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled || !play) return;
    const reduce = prefersReducedMotion();
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = reduce ? 1 : Math.min(1, (now - start) / duration);
      setValue(target * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, play, enabled, duration]);
  if (!enabled) return target;
  return play ? value : 0;
}

export function CountUp({ value, play = true, animate = true, decimals = 2, prefix = "", suffix = "", className = "" }: { value: number; play?: boolean; animate?: boolean; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const v = useCountUp(value, play, { enabled: animate });
  return (
    <span className={`num ${className}`}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** Debounce a value; used so hover-driven map highlights do not chase the pointer. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
