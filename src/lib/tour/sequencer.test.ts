import { describe, expect, it } from "vitest";
import sample from "@/fixtures/plan.sample.json";
import type { Plan } from "@/lib/types";
import {
  buildTimeline,
  createTourController,
  stateAt,
  type CueEvent,
  type PhaseEvent,
  type TourStatus,
} from "./sequencer";

const plan = sample as unknown as Plan;
const N = plan.stops.length;

/** A manual clock: time only moves when the test says so, and frames run on demand. */
function fakeClock() {
  let t = 1000;
  let nextId = 1;
  const queue = new Map<number, () => void>();
  return {
    now: () => t,
    raf: (cb: () => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    /** Advance time in 16 ms frames, running the pending frame at each step. */
    advance(ms: number) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + 16);
        const frames = [...queue.entries()];
        queue.clear();
        frames.forEach(([, cb]) => cb());
      }
    },
  };
}

function harness(opts: { msPerStop?: number; reducedMotion?: boolean } = {}) {
  const timeline = buildTimeline(plan, opts);
  const clock = fakeClock();
  const cues: CueEvent[] = [];
  const phases: PhaseEvent[] = [];
  const statuses: TourStatus[] = [];
  const ctl = createTourController({
    timeline,
    clock,
    onCue: (e) => cues.push(e),
    onPhase: (e) => phases.push(e),
    onStatus: (s) => statuses.push(s),
  });
  return { timeline, clock, cues, phases, statuses, ctl };
}

describe("buildTimeline", () => {
  it("lays out one 6000 ms beat per stop plus a finale", () => {
    const tl = buildTimeline(plan);
    expect(tl.stops).toHaveLength(N);
    expect(tl.stops[0].startMs).toBe(0);
    expect(tl.stops[1].startMs).toBe(6000);
    expect(tl.finale.startMs).toBe(N * 6000);
    expect(tl.totalMs).toBe(N * 6000 + 1600 + 300);
  });

  it("emits the UX.md cue times for a mid-tour stop", () => {
    const beat = buildTimeline(plan).stops[1];
    const at = (kind: string) => beat.cues.filter((c) => c.kind === kind).map((c) => c.at);
    expect(at("fly")).toEqual([0]);
    expect(at("cardOut")).toEqual([0]);
    expect(at("legDraw")).toEqual([0]);
    expect(at("land")).toEqual([1400]);
    expect(at("cardIn")).toEqual([1600]);
    expect(at("countUp")).toEqual([1600]);
    expect(at("bars")).toEqual([2200]);
    expect(at("row")).toEqual([2200, 2260, 2320]);
    expect(at("drift")).toEqual([2600]);
    expect(beat.cues.find((c) => c.kind === "fly")?.durationMs).toBe(1400);
    expect(beat.cues.find((c) => c.kind === "legDraw")?.durationMs).toBe(1200);
    expect(beat.cues.find((c) => c.kind === "drift")?.durationMs).toBe(3400);
  });

  it("has no leg to draw or card to dismiss on the first stop", () => {
    const kinds = buildTimeline(plan).stops[0].cues.map((c) => c.kind);
    expect(kinds).not.toContain("legDraw");
    expect(kinds).not.toContain("cardOut");
    expect(kinds).toContain("fly");
  });

  it("ends with a 1600 ms fit and then the summary", () => {
    const tl = buildTimeline(plan);
    expect(tl.finale.cues.map((c) => [c.kind, c.at, c.durationMs])).toEqual([
      ["fitRoute", 0, 1600],
      ["summary", 1600, 300],
    ]);
  });

  it("keeps timings but drops count-up, drift and travel under reduced motion", () => {
    const tl = buildTimeline(plan, { reducedMotion: true });
    const beat = tl.stops[2];
    expect(beat.cues.map((c) => c.kind)).not.toContain("countUp");
    expect(beat.cues.map((c) => c.kind)).not.toContain("drift");
    expect(beat.cues.find((c) => c.kind === "fly")?.instant).toBe(true);
    expect(beat.cues.find((c) => c.kind === "land")?.at).toBe(1400);
    expect(beat.cues.find((c) => c.kind === "cardIn")?.at).toBe(1600);
    expect(tl.totalMs).toBe(buildTimeline(plan).totalMs);
  });

  it("compresses the beat proportionally for short tours", () => {
    const tl = buildTimeline(plan, { msPerStop: 3000 });
    expect(tl.stops[1].startMs).toBe(3000);
    expect(tl.stops[1].cues.find((c) => c.kind === "land")?.at).toBe(700);
    expect(tl.stops[1].cues.find((c) => c.kind === "cardIn")?.at).toBe(800);
  });

  it("orders the global event list by time", () => {
    const { events } = buildTimeline(plan);
    for (let i = 1; i < events.length; i++) expect(events[i].atMs).toBeGreaterThanOrEqual(events[i - 1].atMs);
  });
});

describe("stateAt", () => {
  const tl = buildTimeline(plan);
  it("maps elapsed time onto stop phases", () => {
    const phase = (t: number) => stateAt(tl, t).phase;
    expect(phase(0)).toBe("leave");
    expect(phase(199)).toBe("leave");
    expect(phase(200)).toBe("travel");
    expect(phase(1399)).toBe("travel");
    expect(phase(1400)).toBe("land");
    expect(phase(1600)).toBe("card");
    expect(phase(2200)).toBe("detail");
    expect(phase(2600)).toBe("hold");
    expect(phase(5999)).toBe("hold");
    expect(stateAt(tl, 6000)).toMatchObject({ index: 1, phase: "leave", localMs: 0 });
  });

  it("enters the finale after the last stop and clamps at the end", () => {
    expect(stateAt(tl, N * 6000 - 1)).toMatchObject({ index: N - 1, finale: false });
    expect(stateAt(tl, N * 6000)).toMatchObject({ index: N, finale: true, phase: "fit" });
    expect(stateAt(tl, N * 6000 + 1600).phase).toBe("summary");
    expect(stateAt(tl, 1e9).elapsedMs).toBe(tl.totalMs);
  });
});

describe("createTourController", () => {
  it("fires each cue once, at its time, while playing", () => {
    const { ctl, clock, cues } = harness();
    ctl.play();
    clock.advance(1300);
    const kindsEarly = cues.map((c) => c.cue.kind);
    expect(kindsEarly).toContain("fly");
    expect(kindsEarly).not.toContain("land");
    clock.advance(200); // t = 1500
    expect(cues.filter((c) => c.cue.kind === "land")).toHaveLength(1);
    clock.advance(1000); // t = 2500
    expect(cues.filter((c) => c.cue.kind === "cardIn")).toHaveLength(1);
    expect(cues.filter((c) => c.cue.kind === "bars")).toHaveLength(1);
    expect(cues.every((c) => c.index === 0 && c.order === 1)).toBe(true);
  });

  it("pauses exactly: elapsed does not drift while paused and resumes from the same point", () => {
    const { ctl, clock, cues } = harness();
    ctl.play();
    clock.advance(2000);
    ctl.pause();
    const frozen = ctl.elapsed();
    expect(frozen).toBeGreaterThanOrEqual(1984);
    expect(frozen).toBeLessThanOrEqual(2000);
    const cueCount = cues.length;
    clock.advance(10_000);
    expect(ctl.elapsed()).toBe(frozen);
    expect(cues).toHaveLength(cueCount);
    expect(ctl.status()).toBe("paused");

    ctl.play();
    clock.advance(1000);
    expect(ctl.elapsed()).toBeGreaterThanOrEqual(frozen + 984);
    expect(ctl.elapsed()).toBeLessThanOrEqual(frozen + 1000);
    expect(cues.filter((c) => c.cue.kind === "bars")).toHaveLength(1); // crossed 2200 after resume
  });

  it("flushes cues crossed up to the exact pause instant", () => {
    const { ctl, clock, cues } = harness();
    ctl.play();
    clock.advance(1405);
    ctl.pause();
    expect(cues.filter((c) => c.cue.kind === "land")).toHaveLength(1);
  });

  it("emits a phase event only when the phase changes", () => {
    const { ctl, clock, phases } = harness();
    ctl.play();
    clock.advance(2700);
    expect(phases.map((p) => p.phase)).toEqual(["leave", "travel", "land", "card", "detail", "hold"]);
    expect(phases.every((p) => !p.jump)).toBe(true);
  });

  it("advances to the next stop at msPerStop", () => {
    const { ctl, clock, phases } = harness();
    ctl.play();
    clock.advance(6100);
    const last = phases[phases.length - 1];
    expect(last).toMatchObject({ index: 1, phase: "leave" });
  });

  it("seek jumps to a stop, flags the phase event and fires that stop's opening cues", () => {
    const { ctl, clock, cues, phases } = harness();
    ctl.play();
    clock.advance(500);
    cues.length = 0;
    phases.length = 0;
    ctl.seek(4);
    expect(ctl.elapsed()).toBe(4 * 6000);
    expect(phases[0]).toMatchObject({ index: 4, phase: "leave", jump: true });
    expect(cues.map((c) => c.cue.kind).sort()).toEqual(["cardOut", "fly", "legDraw"]);
    expect(cues.every((c) => c.order === 5 && c.jump)).toBe(true);
    clock.advance(1500);
    expect(cues.filter((c) => c.cue.kind === "land")).toHaveLength(1);
    expect(ctl.status()).toBe("playing");
  });

  it("seek while paused stays paused and replays nothing on resume", () => {
    const { ctl, clock, cues } = harness();
    ctl.play();
    clock.advance(3000);
    ctl.pause();
    ctl.seek(2);
    expect(ctl.status()).toBe("paused");
    const n = cues.length;
    clock.advance(5000);
    expect(cues).toHaveLength(n);
    ctl.play();
    clock.advance(100);
    expect(cues.filter((c) => c.cue.kind === "fly" && c.index === 2)).toHaveLength(1);
  });

  it("next and prev step one stop and clamp at the ends", () => {
    const { ctl } = harness();
    ctl.seek(0);
    ctl.next();
    expect(ctl.state().index).toBe(1);
    ctl.prev();
    expect(ctl.state().index).toBe(0);
    ctl.prev();
    expect(ctl.state().index).toBe(0);
    ctl.seek(N - 1);
    ctl.next();
    expect(ctl.state()).toMatchObject({ index: N, finale: true });
    ctl.next();
    expect(ctl.state().index).toBe(N);
    ctl.prev();
    expect(ctl.state().index).toBe(N - 1);
  });

  it("runs the finale and ends", () => {
    const { ctl, clock, cues, statuses } = harness();
    ctl.seek(N - 1);
    ctl.play();
    clock.advance(6000 + 2000);
    expect(ctl.status()).toBe("ended");
    expect(statuses).toContain("ended");
    expect(cues.filter((c) => c.cue.kind === "fitRoute")).toHaveLength(1);
    expect(cues.filter((c) => c.cue.kind === "summary")).toHaveLength(1);
    expect(ctl.state()).toMatchObject({ finale: true, phase: "summary" });
  });

  it("restart replays from stop one after the tour ended", () => {
    const { ctl, clock, cues } = harness({ msPerStop: 1000 });
    ctl.play();
    clock.advance(N * 1000 + 3000);
    expect(ctl.status()).toBe("ended");
    cues.length = 0;
    ctl.restart();
    expect(ctl.status()).toBe("playing");
    expect(cues.some((c) => c.cue.kind === "fly" && c.index === 0)).toBe(true);
    ctl.destroy();
  });

  it("reports progress through the stop on each tick", () => {
    const { ctl, clock } = harness();
    const seen: number[] = [];
    const off = ctl.subscribeTick((e) => seen.push(e.progress));
    ctl.play();
    clock.advance(3000);
    off();
    const last = seen[seen.length - 1];
    expect(last).toBeGreaterThan(0.48);
    expect(last).toBeLessThan(0.52);
    const count = seen.length;
    clock.advance(100);
    expect(seen).toHaveLength(count);
  });
});
