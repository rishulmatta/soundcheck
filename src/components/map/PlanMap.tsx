"use client";
/**
 * The MapLibre map for Soundcheck.
 *
 * Contract (the plan page and the tour both build against these props):
 *  - plan: candidates become the heatmap points, stops become the route and the numbered markers
 *  - selectedStop: 1-based order of the highlighted stop (marker glow)
 *  - onSelectStop: called when a marker is clicked
 *  - mode: "plan" is interactive and fits the whole route; "tour" has scroll zoom off and the camera is driven
 *    through controllerRef by the sequencer
 *  - controllerRef: imperative handle (flyToStop, fitRoute, setRouteProgress, setBloom, ...)
 *
 * Motion rules (design system README): CSS animates only transform and opacity; map layers animate through
 * MapLibre's camera and setData / setFeatureState, never through React renders.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import { useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import type { CityScore, Plan } from "@/lib/types";
import { easeInOut, easeOut } from "@/lib/tour/ease";
import {
  bboxOf,
  buildLegs,
  haversineKm,
  lineLengthKm,
  lineSliceAlong,
  routeHead,
  routeProgress,
  type LngLat,
} from "@/lib/tour/geo";
import { loadBasemapStyle, readMapTokens, type StyleJson } from "./basemap";

export interface PlanMapController {
  /** Fly the camera to a stop (1-based order). Tour default: zoom 8.5, pitch 30, 1400 ms. */
  flyToStop(order: number, opts?: { durationMs?: number; zoom?: number; pitch?: number; instant?: boolean }): void;
  /** Fit the whole route; the tour finale uses 1600 ms. */
  fitRoute(opts?: { durationMs?: number; instant?: boolean }): void;
  /** Draw the route as of stop `order`, with its incoming leg `t` (0..1) complete. */
  setRouteProgress(order: number, t: number): void;
  /**
   * Bloom the heatmap points nearest to a stop and land its marker (on), or put them back (off).
   * In tour mode markers are hidden until their stop blooms.
   */
  setBloom(order: number, on: boolean, opts?: { instant?: boolean }): void;
  /** Finale styling: Untapped stops keep their glow, Established stops dim to ink-muted. */
  setFinale(on: boolean): void;
  /** A slow 2 percent zoom drift for the hold, lasting `durationMs`. */
  drift(durationMs: number): void;
  /** Cancel a running drift without disturbing a fly in progress. */
  stopDrift(): void;
}

export interface PlanMapProps {
  plan: Plan;
  selectedStop?: number;
  onSelectStop?: (order: number) => void;
  mode?: "plan" | "tour";
  controllerRef?: MutableRefObject<PlanMapController | null>;
  className?: string;
  /** Tour: called once the basemap and layers are ready and the controller is set. */
  onReady?: () => void;
  /** Tour: the viewer started (true) or finished (false) dragging the map. */
  onUserDrag?: (dragging: boolean) => void;
}

type CandidateWithCells = CityScore & { cells?: { lat: number; lon: number; weight?: number }[] };

const SRC_HEAT = "sc-heat";
const SRC_ROUTE = "sc-route";
const SRC_HEAD = "sc-route-head";
const BLOOM_MS = 400;
const BLOOM_STAGGER_MS = 20;
const MAX_STAGGERED = 12;
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Probed once per page. This is the getSnapshot of a useSyncExternalStore, which React calls on every render, and
 * each probe would otherwise create a WebGL context that is never released. Browsers cap live contexts (Chrome:
 * 16 per page) and evict the oldest when the cap is hit, which was the map's own context: the map went blank,
 * webglcontextlost fired and the component fell back to the list after a handful of re-renders.
 */
let webglSupport: boolean | null = null;
function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    webglSupport = !!gl;
    // Give the probe context back straight away so it never counts against the cap.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/**
 * MapLibre finds its worker next to its own script, which a bundler moves. The worker file is self-contained,
 * so let the bundler emit it as an asset and point MapLibre at that URL.
 */
let workerConfigured = false;
function configureWorker() {
  if (workerConfigured) return;
  workerConfigured = true;
  setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
}

const subscribeNever = () => () => {};

const noopController: PlanMapController = {
  flyToStop() {},
  fitRoute() {},
  setRouteProgress() {},
  setBloom() {},
  setFinale() {},
  drift() {},
  stopDrift() {},
};

/** Padding that keeps the focus clear of the tour card (bottom-left) and controls (bottom-centre). */
function tourPadding() {
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  if (w < 640) return { top: 96, bottom: 470, left: 16, right: 16 };
  if (w < 1024) return { top: 110, bottom: 420, left: 40, right: 40 };
  return { top: 110, bottom: 260, left: 40, right: 40 };
}

const planPadding = { top: 56, bottom: 56, left: 56, right: 56 };

interface MarkerEntry {
  order: number;
  root: HTMLButtonElement;
  disc: HTMLSpanElement;
  quadrant: CityScore["quadrant"];
  marker: Marker;
}

export default function PlanMap({
  plan,
  selectedStop,
  onSelectStop,
  mode = "plan",
  controllerRef,
  className,
  onReady,
  onUserDrag,
}: PlanMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // WebGL support is a property of the browser, not of React state: read it as an external value.
  const webgl = useSyncExternalStore(subscribeNever, hasWebGL, () => true);
  const [failed, setFailed] = useState(false);
  // Bumped by "Load map again" in the fallback: re-runs the build effect after a transient failure.
  const [attempt, setAttempt] = useState(0);
  const fallback = !webgl || failed;

  // Latest-value refs so the map is built once per dataset, not once per render.
  const planRef = useRef(plan);
  const selectedRef = useRef(selectedStop);
  const onSelectRef = useRef(onSelectStop);
  const onReadyRef = useRef(onReady);
  const onDragRef = useRef(onUserDrag);
  const markersRef = useRef<MarkerEntry[]>([]);
  const mapRef = useRef<MapLibreMap | null>(null);
  const clickedRef = useRef(false);
  const paintRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    planRef.current = plan;
    onSelectRef.current = onSelectStop;
    onReadyRef.current = onReady;
    onDragRef.current = onUserDrag;
  });

  const dataKey = `${plan.id}|${plan.stops.map((s) => `${s.order}:${s.city.id}`).join(",")}|${plan.candidates.length}|${mode}`;

  useEffect(() => {
    const container = containerRef.current;
    const currentPlan = planRef.current;
    if (!container) return;
    if (!webgl) {
      if (controllerRef) controllerRef.current = noopController;
      onReadyRef.current?.();
      return;
    }

    let disposed = false;
    let map: MapLibreMap | null = null;
    const rafs = new Set<number>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const isTour = mode === "tour";

    // ---- derived geometry -------------------------------------------------------------------------------
    const stops = currentPlan.stops;
    const stopPoints: LngLat[] = stops.map((s) => [s.city.lon, s.city.lat]);
    const legs = buildLegs(stopPoints);
    const fullRoute: LngLat[] = [];
    legs.forEach((leg) => leg.forEach((p, i) => (i === 0 && fullRoute.length ? null : fullRoute.push(p))));
    const bbox = bboxOf(stopPoints.length ? stopPoints : currentPlan.candidates.map((c) => [c.lon, c.lat] as LngLat));
    const boundsOrNull = bbox ? new LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]) : null;

    // Every candidate belongs to its nearest stop, so each stop blooms "its" neighbourhood.
    const candidates = currentPlan.candidates as CandidateWithCells[];
    const affs = candidates.map((c) => c.affinity);
    const minAff = Math.min(...affs, 1);
    const maxAff = Math.max(...affs, 0);
    const norm = (a: number) => (maxAff - minAff < 1e-6 ? 0.5 : (a - minAff) / (maxAff - minAff));

    interface HeatPoint {
      id: string;
      lngLat: LngLat;
      r: number;
      order: number;
      distKm: number;
    }
    const heatPoints: HeatPoint[] = [];
    for (const c of candidates) {
      let order = 0;
      let best = Infinity;
      stopPoints.forEach((p, i) => {
        const d = haversineKm(p, [c.lon, c.lat]);
        if (d < best) {
          best = d;
          order = i + 1;
        }
      });
      const untappedBoost = c.quadrant === "untapped" ? 1.2 : 1;
      const r = (4 + 10 * norm(c.affinity)) * untappedBoost;
      heatPoints.push({ id: c.id, lngLat: [c.lon, c.lat], r, order, distKm: Number.isFinite(best) ? best : 0 });
      (c.cells ?? []).forEach((cell, i) => {
        const w = cell.weight ?? 0.5;
        heatPoints.push({
          id: `${c.id}#${i}`,
          lngLat: [cell.lon, cell.lat],
          r: (3 + 8 * w) * untappedBoost,
          order,
          distKm: Number.isFinite(best) ? best + haversineKm(stopPoints[order - 1] ?? [c.lon, c.lat], [cell.lon, cell.lat]) : 0,
        });
      });
    }
    const groupByOrder = new Map<number, HeatPoint[]>();
    for (const p of heatPoints) {
      const g = groupByOrder.get(p.order) ?? [];
      g.push(p);
      groupByOrder.set(p.order, g);
    }
    groupByOrder.forEach((g) => g.sort((a, b) => a.distKm - b.distKm));

    // ---- markers ----------------------------------------------------------------------------------------
    const buildMarkers = (m: MapLibreMap) => {
      const entries: MarkerEntry[] = [];
      stops.forEach((stop) => {
        const root = document.createElement("button");
        root.type = "button";
        root.setAttribute("aria-label", `Stop ${stop.order}, ${stop.city.name}`);
        Object.assign(root.style, {
          width: "26px",
          height: "26px",
          padding: "0",
          margin: "0",
          border: "0",
          background: "none",
          cursor: isTour ? "default" : "pointer",
          pointerEvents: isTour ? "none" : "auto",
        } satisfies Partial<CSSStyleDeclaration>);
        const disc = document.createElement("span");
        disc.textContent = String(stop.order);
        Object.assign(disc.style, {
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "26px",
          height: "26px",
          borderRadius: "999px",
          background: "var(--spot)",
          color: "var(--on-spot)",
          border: "2px solid var(--bg-sunken)",
          font: '500 13px/1 var(--font-plex-mono), ui-monospace, Menlo, monospace',
          fontVariantNumeric: "tabular-nums",
          transition: "box-shadow 150ms var(--ease-out), background 300ms var(--ease-out), opacity 150ms var(--ease-out)",
          opacity: isTour ? "0" : "1",
          willChange: "transform, opacity",
        } satisfies Partial<CSSStyleDeclaration>);
        root.appendChild(disc);
        root.addEventListener("click", (ev) => {
          ev.stopPropagation();
          clickedRef.current = true;
          onSelectRef.current?.(stop.order);
        });
        root.addEventListener("mouseenter", () => {
          if (!isTour) disc.style.boxShadow = "var(--shadow-glow)";
        });
        root.addEventListener("mouseleave", () => paintSelection());
        const marker = new Marker({ element: root, anchor: "center" }).setLngLat([stop.city.lon, stop.city.lat]).addTo(m);
        entries.push({ order: stop.order, root, disc, quadrant: stop.city.quadrant, marker });
      });
      markersRef.current = entries;
      paintSelection();
    };

    function paintSelection() {
      const sel = selectedRef.current;
      for (const e of markersRef.current) {
        const on = e.order === sel;
        e.disc.style.boxShadow = on ? "var(--shadow-glow)" : "none";
        e.root.style.zIndex = on ? "2" : "1";
      }
    }

    paintRef.current = paintSelection;

    const pulse = (entry: MarkerEntry) => {
      if (prefersReducedMotion() || typeof entry.disc.animate !== "function") return;
      const spring = `cubic-bezier(0.34, 1.56, 0.64, 1)`;
      entry.disc.animate(
        [
          { transform: "scale(1)", easing: spring },
          { transform: "scale(1.4)", offset: 0.5, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
          { transform: "scale(1)" },
        ],
        { duration: BLOOM_MS },
      );
    };

    // ---- feature-state bloom animator -------------------------------------------------------------------
    interface BloomAnim {
      id: string;
      start: number;
      from: number;
      to: number;
      dur: number;
    }
    const blooms = new Map<string, BloomAnim>();
    const bloomValue = new Map<string, number>();
    let bloomRaf: number | null = null;

    const writeBloom = (id: string, v: number) => {
      bloomValue.set(id, v);
      try {
        map?.setFeatureState({ source: SRC_HEAT, id }, { bloom: v });
      } catch {
        /* source not ready */
      }
    };
    const bloomFrame = () => {
      bloomRaf = null;
      const now = performance.now();
      blooms.forEach((a, id) => {
        const p = Math.max(0, Math.min(1, (now - a.start) / a.dur));
        if (now < a.start) return;
        const eased = a.to > a.from ? easeOut(p) : p;
        writeBloom(id, a.from + (a.to - a.from) * eased);
        if (p >= 1) blooms.delete(id);
      });
      if (blooms.size) {
        bloomRaf = requestAnimationFrame(bloomFrame);
        rafs.add(bloomRaf);
      }
    };
    const startBloomLoop = () => {
      if (bloomRaf === null) {
        bloomRaf = requestAnimationFrame(bloomFrame);
        rafs.add(bloomRaf);
      }
    };

    // ---- route ------------------------------------------------------------------------------------------
    const lineFeature = (coords: LngLat[]) =>
      coords.length >= 2
        ? { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } }] }
        : EMPTY_FC;
    const headFeature = (p: LngLat | null) =>
      p ? { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: p } }] } : EMPTY_FC;
    const setSource = (id: string, data: unknown) => {
      const src = map?.getSource(id) as { setData?: (d: unknown) => void } | undefined;
      src?.setData?.(data);
    };

    let lastRoute = "";
    const setRouteProgress = (order: number, t: number) => {
      const key = `${order}:${t.toFixed(4)}`;
      if (key === lastRoute) return;
      lastRoute = key;
      setSource(SRC_ROUTE, lineFeature(routeProgress(legs, order, t)));
      setSource(SRC_HEAD, headFeature(t > 0 && t < 1 ? routeHead(legs, order, t) : null));
    };

    // Plan mode: the finished route draws itself once, over 600 ms.
    const drawFullRoute = () => {
      if (fullRoute.length < 2) return;
      if (prefersReducedMotion()) {
        setSource(SRC_ROUTE, lineFeature(fullRoute));
        return;
      }
      const total = lineLengthKm(fullRoute);
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / 600);
        setSource(SRC_ROUTE, lineFeature(lineSliceAlong(fullRoute, 0, total * easeInOut(p))));
        if (p < 1 && !disposed) rafs.add(requestAnimationFrame(step));
      };
      rafs.add(requestAnimationFrame(step));
    };

    // ---- camera -----------------------------------------------------------------------------------------
    let drifting = false;
    const stopDrift = () => {
      if (drifting && map) {
        drifting = false;
        map.stop();
      }
    };

    const controller: PlanMapController = {
      flyToStop(order, opts) {
        const stop = stops[order - 1];
        if (!map || !stop) return;
        stopDrift();
        // Shift the focus up by half the net chrome height instead of using persistent camera padding,
        // which MapLibre would add to fitBounds padding later and zoom the finale far too wide.
        const pad = isTour ? tourPadding() : null;
        const target = {
          center: [stop.city.lon, stop.city.lat] as LngLat,
          zoom: opts?.zoom ?? 8.5,
          pitch: opts?.pitch ?? (isTour ? 30 : 0),
          bearing: 0,
          offset: (pad ? [0, (pad.top - pad.bottom) / 2] : [0, 0]) as [number, number],
        };
        const duration = opts?.durationMs ?? 1400;
        if (opts?.instant || duration <= 0 || prefersReducedMotion()) map.easeTo({ ...target, duration: 0 });
        else map.flyTo({ ...target, duration, curve: 1.4, essential: true, easing: easeInOut });
      },
      fitRoute(opts) {
        if (!map || !boundsOrNull) return;
        stopDrift();
        const duration = opts?.durationMs ?? 1600;
        const fit = {
          padding: isTour ? tourPadding() : planPadding,
          maxZoom: 6,
          pitch: 0,
          bearing: 0,
        };
        if (opts?.instant || duration <= 0 || prefersReducedMotion()) map.fitBounds(boundsOrNull, { ...fit, duration: 0 });
        else map.fitBounds(boundsOrNull, { ...fit, duration, easing: easeInOut, essential: true });
      },
      setRouteProgress,
      setBloom(order, on, opts) {
        const entry = markersRef.current.find((e) => e.order === order);
        const group = groupByOrder.get(order) ?? [];
        const instant = opts?.instant || prefersReducedMotion();
        const now = performance.now();
        group.forEach((p, i) => {
          const from = bloomValue.get(p.id) ?? (on ? 0 : 1);
          const to = on ? 1 : 0;
          if (from === to && !blooms.has(p.id)) return;
          if (instant) {
            blooms.delete(p.id);
            writeBloom(p.id, to);
          } else {
            const delay = Math.min(i, MAX_STAGGERED - 1) * BLOOM_STAGGER_MS;
            blooms.set(p.id, { id: p.id, start: now + delay, from, to, dur: on ? BLOOM_MS : 150 });
          }
        });
        if (blooms.size) startBloomLoop();
        if (entry && isTour) {
          if (on) {
            entry.disc.style.opacity = "1";
            if (!instant) pulse(entry);
          } else {
            entry.disc.style.opacity = "0";
          }
        }
      },
      setFinale(on) {
        for (const e of markersRef.current) {
          const dim = on && e.quadrant !== "untapped";
          e.disc.style.background = dim ? "var(--ink-muted)" : "var(--spot)";
          if (on && e.quadrant === "untapped") e.disc.style.boxShadow = "var(--shadow-glow)";
          else if (!on) paintSelection();
          else e.disc.style.boxShadow = "none";
        }
      },
      drift(durationMs) {
        if (!map || prefersReducedMotion() || durationMs <= 0) return;
        drifting = true;
        map.easeTo({ zoom: map.getZoom() * 1.02, duration: durationMs, easing: (t) => t, essential: true });
        map.once("moveend", () => {
          drifting = false;
        });
      },
      stopDrift,
    };

    // ---- build the map ----------------------------------------------------------------------------------
    loadBasemapStyle()
      .then((style: StyleJson) => {
        if (disposed) return;
        const tokens = readMapTokens();
        try {
          configureWorker();
          map = new MapLibreMap({
            container,
            style: style as unknown as never,
            attributionControl: false,
            ...(boundsOrNull
              ? { bounds: boundsOrNull, fitBoundsOptions: { padding: isTour ? tourPadding() : planPadding, maxZoom: 6 } }
              : { center: [-98, 39] as LngLat, zoom: 3.4 }),
            maxPitch: 60,
            dragRotate: false,
            pitchWithRotate: false,
            fadeDuration: 0,
            canvasContextAttributes: { antialias: true },
          });
        } catch {
          setFailed(true);
          if (controllerRef) controllerRef.current = noopController;
          onReadyRef.current?.();
          return;
        }
        mapRef.current = map;
        const m = map;
        m.addControl(new AttributionControl({ compact: true }), "bottom-right");
        if (isTour) {
          m.scrollZoom.disable();
          m.doubleClickZoom.disable();
          m.keyboard.disable();
          m.touchZoomRotate.disableRotation();
          m.on("dragstart", () => onDragRef.current?.(true));
          m.on("dragend", () => onDragRef.current?.(false));
        } else {
          m.addControl(new NavigationControl({ showCompass: false }), "top-right");
          m.touchZoomRotate.disableRotation();
        }

        // WebGL context loss: degrade to the list rather than a frozen canvas.
        // preventDefault lets MapLibre restore the context; only give up if it does not come back.
        let lostTimer: ReturnType<typeof setTimeout> | null = null;
        m.getCanvas().addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          lostTimer = setTimeout(() => setFailed(true), 3000);
          timers.add(lostTimer);
        });
        m.getCanvas().addEventListener("webglcontextrestored", () => {
          if (lostTimer) clearTimeout(lostTimer);
        });

        const finish = () => {
          if (disposed) return;
          container.style.opacity = "1";
          if (controllerRef) controllerRef.current = controller;
          onReadyRef.current?.();
        };

        m.on("load", () => {
          if (disposed) return;
          const firstSymbol = style.layers.find((l) => l.type === "symbol" && l.layout?.visibility !== "none")?.id;

          m.addSource(SRC_HEAT, {
            type: "geojson",
            promoteId: "id",
            data: {
              type: "FeatureCollection",
              features: heatPoints.map((p) => ({
                type: "Feature" as const,
                properties: { id: p.id, r: p.r },
                geometry: { type: "Point" as const, coordinates: p.lngLat },
              })),
            },
          });
          const bloom: unknown[] = ["coalesce", ["feature-state", "bloom"], 1];
          const scale: unknown[] = ["+", 0.6, ["*", 0.4, bloom]];
          // Glow grows as the camera comes in, so it still reads at the tour's zoom of 8.5.
          const radius = (mult: number): unknown[] => [
            "interpolate",
            ["linear"],
            ["zoom"],
            3,
            ["*", ["get", "r"], scale, mult],
            6,
            ["*", ["get", "r"], scale, mult * 1.7],
            9,
            ["*", ["get", "r"], scale, mult * 3],
          ];
          m.addLayer(
            {
              id: "sc-heat-halo",
              type: "circle",
              source: SRC_HEAT,
              paint: {
                "circle-color": tokens.signal,
                "circle-blur": 1,
                "circle-radius": radius(2.4) as never,
                "circle-opacity": ["*", 0.25, bloom] as never,
              },
            },
            firstSymbol,
          );
          m.addLayer(
            {
              id: "sc-heat-core",
              type: "circle",
              source: SRC_HEAT,
              paint: {
                "circle-color": tokens.signal,
                "circle-blur": 0.25,
                "circle-radius": radius(1) as never,
                "circle-opacity": ["*", 0.4, bloom] as never,
              },
            },
            firstSymbol,
          );

          m.addSource(SRC_ROUTE, { type: "geojson", data: isTour ? EMPTY_FC : lineFeature([]) });
          m.addLayer({
            id: "sc-route",
            type: "line",
            source: SRC_ROUTE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": tokens.spot, "line-width": 2 },
          });
          m.addSource(SRC_HEAD, { type: "geojson", data: EMPTY_FC });
          m.addLayer({
            id: "sc-route-head",
            type: "circle",
            source: SRC_HEAD,
            paint: { "circle-color": tokens.spot, "circle-radius": 4, "circle-blur": 0.2 },
          });

          buildMarkers(m);

          if (isTour) {
            // Everything starts dark; stops light the map up as the tour reaches them.
            heatPoints.forEach((p) => writeBloom(p.id, 0));
          } else {
            drawFullRoute();
          }

          // Wait for the first frame's tiles so autoplay does not start on an empty map.
          let done = false;
          const ready = () => {
            if (done) return;
            done = true;
            finish();
          };
          m.once("idle", ready);
          const t = setTimeout(ready, 4000);
          timers.add(t);
        });

        m.on("error", (e) => {
          const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? "");
          if (/webgl/i.test(msg)) setFailed(true);
        });
      })
      .catch(() => {
        if (disposed) return;
        // Offline or the tile host is down: keep the list fallback, keep the tour narrating.
        setFailed(true);
        if (controllerRef) controllerRef.current = noopController;
        onReadyRef.current?.();
      });

    return () => {
      disposed = true;
      rafs.forEach((id) => cancelAnimationFrame(id));
      timers.forEach((t) => clearTimeout(t));
      markersRef.current.forEach((e) => e.marker.remove());
      markersRef.current = [];
      if (controllerRef && (controllerRef.current === controller || controllerRef.current === noopController)) {
        controllerRef.current = null;
      }
      mapRef.current = null;
      map?.remove();
      map = null;
    };
  }, [dataKey, mode, controllerRef, webgl, attempt]);

  // Selected marker glow (cheap, no rebuild). In plan mode a selection from outside also flies the camera.
  useEffect(() => {
    selectedRef.current = selectedStop;
    paintRef.current?.();
    if (mode !== "plan" || !selectedStop) return;
    if (clickedRef.current) {
      clickedRef.current = false;
      return;
    }
    const stop = plan.stops[selectedStop - 1];
    const map = mapRef.current;
    if (!stop || !map) return;
    const target = { center: [stop.city.lon, stop.city.lat] as LngLat, zoom: Math.max(map.getZoom(), 6), pitch: 0, bearing: 0 };
    if (prefersReducedMotion()) map.jumpTo(target);
    else map.flyTo({ ...target, duration: 600, essential: true, easing: easeInOut });
  }, [selectedStop, mode, plan.stops]);

  if (fallback) {
    return (
      <div
        className={className}
        style={{
          background: "var(--bg-sunken)",
          borderRadius: mode === "tour" ? 0 : "var(--radius-md)",
          minHeight: 240,
          padding: mode === "tour" ? "150px 24px 200px" : 16,
          color: "var(--ink-muted)",
          overflow: "auto",
        }}
        role="region"
        aria-label="Tour route"
      >
        <p className="label" style={{ margin: "0 0 8px" }}>
          Route
        </p>
        {webgl && failed && mode === "plan" && (
          <p style={{ margin: "0 0 12px", fontSize: 13, display: "flex", gap: 12, alignItems: "baseline" }}>
            <span>The map could not load.</span>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              style={{ all: "unset", cursor: "pointer", color: "var(--ink)", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Load map again
            </button>
          </p>
        )}
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {plan.stops.map((s) => (
            <li key={s.order}>
              <button
                type="button"
                onClick={() => onSelectStop?.(s.order)}
                style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: s.order === selectedStop ? "var(--ink)" : "var(--ink-muted)" }}
              >
                <span
                  className="num"
                  style={{ width: 24, height: 24, borderRadius: 999, background: "var(--spot)", color: "var(--on-spot)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}
                >
                  {s.order}
                </span>
                <span className="disp" style={{ fontSize: 20 }}>
                  {s.city.name}
                </span>
                <span className="num" style={{ fontSize: 12 }}>
                  {s.city.affinity.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ position: "relative", background: "var(--bg-sunken)", borderRadius: "var(--radius-md)", overflow: "hidden", minHeight: 240 }}
    >
      <style>{MAP_CSS}</style>
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0, opacity: 0, transition: "opacity 400ms var(--ease-out)" }}
        data-mode={mode}
      />
    </div>
  );
}

/** Dark-theme the MapLibre chrome so it reads as part of the ground. */
const MAP_CSS = `
.maplibregl-canvas:focus { outline: none; }
.maplibregl-ctrl-attrib { background: color-mix(in srgb, var(--bg-sunken) 80%, transparent) !important; color: var(--ink-muted) !important; font: 400 11px/16px var(--font-plex-sans), sans-serif !important; }
.maplibregl-ctrl-attrib a { color: var(--ink-muted) !important; }
.maplibregl-ctrl-attrib-button { background-color: transparent !important; filter: invert(0.7); }
.maplibregl-ctrl-group { background: var(--bg-raised) !important; border: 1px solid var(--line); box-shadow: none !important; border-radius: var(--radius-md) !important; overflow: hidden; }
.maplibregl-ctrl-group button { border-color: var(--line) !important; }
.maplibregl-ctrl-group button .maplibregl-ctrl-icon { filter: invert(0.85); }
@media (max-width: 639px) { [data-mode="tour"] .maplibregl-ctrl-bottom-right { top: 60px; bottom: auto; } }
.maplibregl-marker:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 999px; }
`;
