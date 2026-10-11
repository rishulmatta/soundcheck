/**
 * The map tour as a pure timeline plus a small clock-driven controller.
 *
 * buildTimeline() turns a plan into the per-stop cue list from docs/UX.md ("Screen 4"):
 *
 *   0 ms     fly to the stop, previous card leaves, route leg starts drawing
 *   1400 ms  marker lands and pulses, heatmap blooms
 *   1600 ms  card enters, affinity counts up
 *   2200 ms  bar fills, rows fade in 60 ms apart
 *   2600 ms  hold with a slow zoom drift
 *   6000 ms  next stop
 *   finale   fitBounds over 1600 ms, then the summary card
 *
 * createTourController() plays that timeline. All time comes from one number, the elapsed
 * milliseconds since the tour started, which is accumulated across pauses, so pause and resume
 * are exact and the progress ring can be drawn from the same value as the cues.
 */
import type { Plan } from "@/lib/types";

export const DEFAULT_MS_PER_STOP = 6000;

/** Design-system beat, in ms at the default 6000 ms per stop. */
export const BEAT = {
  leaveMs: 200,
  flyMs: 1400,
  legDrawMs: 1200,
  landAt: 1400,
  cardInAt: 1600,
  cardInMs: 300,
  countMs: 500,
  detailAt: 2200,
  barMs: 400,
  rowStaggerMs: 60,
  rows: 3,
  holdAt: 2600,
  finaleFitMs: 1600,
  summaryMs: 300,
} as const;

export type CueKind =
  | "fly"
  | "cardOut"
  | "legDraw"
  | "land"
  | "cardIn"
  | "countUp"
  | "bars"
  | "row"
  | "drift"
  | "fitRoute"
  | "summary";

export interface Cue {
  /** ms from the start of the stop (or of the finale). */
  at: number;
  kind: CueKind;
  durationMs?: number;
  /** Reduced motion: do the state change without travel or stagger. */
  instant?: boolean;
  /** For "row": which row (0 opener, 1 sponsor, 2 why-here). */
  row?: number;
}

export interface StopBeat {
  index: number;
  /** 1-based stop order from the plan. */
  order: number;
  startMs: number;
  endMs: number;
  cues: Cue[];
}

export interface GlobalCue {
  atMs: number;
  /** Index into stops, or stops.length for the finale. */
  index: number;
  cue: Cue;
}

export type TourPhase = "leave" | "travel" | "land" | "card" | "detail" | "hold" | "fit" | "summary";

export interface Timeline {
  msPerStop: number;
  reducedMotion: boolean;
  stops: StopBeat[];
  finale: { startMs: number; endMs: number; cues: Cue[] };
  /** Phase boundaries within a stop, already scaled for msPerStop. */
  marks: { leave: number; land: number; card: number; detail: number; hold: number; fitEnd: number };
  /** Every cue in global time order. */
  events: GlobalCue[];
  totalMs: number;
}

export interface TimelineOptions {
  msPerStop?: number;
  reducedMotion?: boolean;
}

export function buildTimeline(plan: Pick<Plan, "stops">, opts: TimelineOptions = {}): Timeline {
  const msPerStop = opts.msPerStop ?? DEFAULT_MS_PER_STOP;
  const reducedMotion = opts.reducedMotion ?? false;
  // Short tours compress the whole beat proportionally; long ones just hold longer.
  const k = Math.min(1, msPerStop / DEFAULT_MS_PER_STOP);
  const s = (ms: number) => Math.round(ms * k);

  const marks = {
    leave: s(BEAT.leaveMs),
    land: s(BEAT.landAt),
    card: s(BEAT.cardInAt),
    detail: s(BEAT.detailAt),
    hold: s(BEAT.holdAt),
    fitEnd: s(BEAT.finaleFitMs),
  };

  const stops: StopBeat[] = plan.stops.map((stop, index) => {
    const startMs = index * msPerStop;
    const cues: Cue[] = [];
    cues.push({ at: 0, kind: "fly", durationMs: s(BEAT.flyMs), instant: reducedMotion });
    if (index > 0) {
      cues.push({ at: 0, kind: "cardOut", durationMs: s(BEAT.leaveMs) });
      cues.push({ at: 0, kind: "legDraw", durationMs: s(BEAT.legDrawMs), instant: reducedMotion });
    }
    cues.push({ at: marks.land, kind: "land", durationMs: s(400), instant: reducedMotion });
    cues.push({ at: marks.card, kind: "cardIn", durationMs: s(BEAT.cardInMs) });
    if (!reducedMotion) cues.push({ at: marks.card, kind: "countUp", durationMs: s(BEAT.countMs) });
    cues.push({ at: marks.detail, kind: "bars", durationMs: s(BEAT.barMs) });
    for (let row = 0; row < BEAT.rows; row++) {
      cues.push({ at: marks.detail + s(row * BEAT.rowStaggerMs), kind: "row", row });
    }
    if (!reducedMotion && msPerStop > marks.hold) {
      cues.push({ at: marks.hold, kind: "drift", durationMs: msPerStop - marks.hold });
    }
    cues.sort((a, b) => a.at - b.at);
    return { index, order: stop.order, startMs, endMs: startMs + msPerStop, cues };
  });

  const finaleStart = stops.length * msPerStop;
  const finaleCues: Cue[] = [
    { at: 0, kind: "fitRoute", durationMs: marks.fitEnd, instant: reducedMotion },
    { at: marks.fitEnd, kind: "summary", durationMs: s(BEAT.summaryMs) },
  ];
  const finaleEnd = finaleStart + marks.fitEnd + s(BEAT.summaryMs);

  const events: GlobalCue[] = [];
  for (const beat of stops) {
    for (const cue of beat.cues) events.push({ atMs: beat.startMs + cue.at, index: beat.index, cue });
  }
  for (const cue of finaleCues) events.push({ atMs: finaleStart + cue.at, index: stops.length, cue });
  // Stable: Array.prototype.sort keeps authoring order for equal times.
  events.sort((a, b) => a.atMs - b.atMs);

  return {
    msPerStop,
    reducedMotion,
    stops,
    finale: { startMs: finaleStart, endMs: finaleEnd, cues: finaleCues },
    marks,
    events,
    totalMs: finaleEnd,
  };
}

export interface TourState {
  /** Current stop index; equals stops.length during the finale. */
  index: number;
  finale: boolean;
  phase: TourPhase;
  /** ms since this stop (or the finale) began. */
  localMs: number;
  elapsedMs: number;
}

/** Where the tour is at elapsed time t. Pure. */
export function stateAt(timeline: Timeline, t: number): TourState {
  const elapsedMs = Math.max(0, Math.min(t, timeline.totalMs));
  const n = timeline.stops.length;
  if (n === 0 || elapsedMs >= timeline.finale.startMs) {
    const localMs = elapsedMs - timeline.finale.startMs;
    return { index: n, finale: true, phase: localMs >= timeline.marks.fitEnd ? "summary" : "fit", localMs, elapsedMs };
  }
  const index = Math.min(n - 1, Math.floor(elapsedMs / timeline.msPerStop));
  const localMs = elapsedMs - index * timeline.msPerStop;
  const m = timeline.marks;
  const phase: TourPhase =
    localMs < m.leave
      ? "leave"
      : localMs < m.land
        ? "travel"
        : localMs < m.card
          ? "land"
          : localMs < m.detail
            ? "card"
            : localMs < m.hold
              ? "detail"
              : "hold";
  return { index, finale: false, phase, localMs, elapsedMs };
}

/** Elapsed time at which stop `index` begins; index === stops.length is the finale. */
export function startOf(timeline: Timeline, index: number): number {
  if (index >= timeline.stops.length) return timeline.finale.startMs;
  return timeline.stops[Math.max(0, index)].startMs;
}

export interface PhaseEvent extends TourState {
  /** True when caused by a seek/restart rather than the clock running. UI should snap, not animate out. */
  jump: boolean;
}

export interface CueEvent {
  cue: Cue;
  /** Stop index (stops.length for the finale). */
  index: number;
  /** 1-based plan order of that stop, or 0 for the finale. */
  order: number;
  /** True when fired by a seek. */
  jump: boolean;
}

export interface TickEvent extends TourState {
  /** 0..1 through the current stop; 1 in the finale. Drives the progress ring. */
  progress: number;
  totalMs: number;
}

export type TourStatus = "idle" | "playing" | "paused" | "ended";

export interface TourClock {
  now(): number;
  raf(cb: () => void): number;
  caf(handle: number): void;
}

export interface TourControllerOptions {
  timeline: Timeline;
  clock?: Partial<TourClock>;
  onPhase?: (e: PhaseEvent) => void;
  onCue?: (e: CueEvent) => void;
  onTick?: (e: TickEvent) => void;
  onStatus?: (status: TourStatus) => void;
}

export interface TourController {
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  /** Jump to the start of stop `index` (0-based); index === stop count jumps to the finale. */
  seek(index: number): void;
  /** Seek to the start and play. */
  restart(): void;
  elapsed(): number;
  state(): TourState;
  status(): TourStatus;
  subscribeTick(fn: (e: TickEvent) => void): () => void;
  destroy(): void;
}

function defaultClock(partial?: Partial<TourClock>): TourClock {
  return {
    now: partial?.now ?? (() => performance.now()),
    raf: partial?.raf ?? ((cb) => requestAnimationFrame(() => cb())),
    caf: partial?.caf ?? ((h) => cancelAnimationFrame(h)),
  };
}

export function createTourController(options: TourControllerOptions): TourController {
  const { timeline } = options;
  const clock = defaultClock(options.clock);
  const tickListeners = new Set<(e: TickEvent) => void>();

  let status: TourStatus = "idle";
  /** Elapsed ms accumulated up to the last pause or seek. */
  let baseMs = 0;
  /** clock.now() when the current run began; null while paused. */
  let startedAt: number | null = null;
  let cursor = 0;
  let lastKey = "";
  let handle: number | null = null;

  const setStatus = (next: TourStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const elapsed = () => {
    if (startedAt === null) return baseMs;
    return Math.min(timeline.totalMs, baseMs + (clock.now() - startedAt));
  };

  /** Emit phase changes, fire the cues crossed since the last call, then tick. */
  const advance = (t: number, jump: boolean) => {
    const st = stateAt(timeline, t);
    const key = `${st.index}:${st.phase}`;
    if (jump || key !== lastKey) {
      lastKey = key;
      options.onPhase?.({ ...st, jump });
    }
    while (cursor < timeline.events.length && timeline.events[cursor].atMs <= t) {
      const ev = timeline.events[cursor++];
      const beat = timeline.stops[ev.index];
      options.onCue?.({ cue: ev.cue, index: ev.index, order: beat ? beat.order : 0, jump });
    }
    const tick: TickEvent = {
      ...st,
      progress: st.finale ? 1 : Math.max(0, Math.min(1, st.localMs / timeline.msPerStop)),
      totalMs: timeline.totalMs,
    };
    options.onTick?.(tick);
    tickListeners.forEach((fn) => fn(tick));
  };

  const cancelFrame = () => {
    if (handle !== null) {
      clock.caf(handle);
      handle = null;
    }
  };

  const frame = () => {
    handle = null;
    if (startedAt === null) return;
    const t = elapsed();
    advance(t, false);
    if (t >= timeline.totalMs) {
      baseMs = timeline.totalMs;
      startedAt = null;
      setStatus("ended");
      return;
    }
    handle = clock.raf(frame);
  };

  const cursorFor = (t: number) => {
    let i = 0;
    while (i < timeline.events.length && timeline.events[i].atMs < t) i++;
    return i;
  };

  const api: TourController = {
    play() {
      if (status === "playing") return;
      if (baseMs >= timeline.totalMs) {
        api.restart();
        return;
      }
      startedAt = clock.now();
      setStatus("playing");
      cancelFrame();
      handle = clock.raf(frame);
    },
    pause() {
      if (status !== "playing") return;
      baseMs = elapsed();
      startedAt = null;
      cancelFrame();
      setStatus("paused");
      advance(baseMs, false);
    },
    toggle() {
      if (status === "playing") api.pause();
      else api.play();
    },
    seek(index) {
      const n = timeline.stops.length;
      const i = Math.max(0, Math.min(n, Math.round(index)));
      const t = startOf(timeline, i);
      const wasPlaying = status === "playing";
      baseMs = t;
      startedAt = wasPlaying ? clock.now() : null;
      cursor = cursorFor(t);
      if (status === "ended" || status === "idle") setStatus("paused");
      advance(t, true);
      // The finale is the last moment; if the seek lands past it while playing, the next frame ends the run.
    },
    next() {
      api.seek(stateAt(timeline, elapsed()).index + 1);
    },
    prev() {
      const st = stateAt(timeline, elapsed());
      api.seek(st.finale ? timeline.stops.length - 1 : st.index - 1);
    },
    restart() {
      cancelFrame();
      startedAt = null;
      baseMs = 0;
      cursor = 0;
      lastKey = "";
      setStatus("paused");
      advance(0, true);
      api.play();
    },
    elapsed,
    state: () => stateAt(timeline, elapsed()),
    status: () => status,
    subscribeTick(fn) {
      tickListeners.add(fn);
      return () => {
        tickListeners.delete(fn);
      };
    },
    destroy() {
      cancelFrame();
      startedAt = null;
      tickListeners.clear();
    },
  };

  return api;
}
