import type { Plan, PlanEvent, TraceStep } from "@/lib/types";

export interface TimedEvent {
  /** Milliseconds to wait before emitting this event. */
  delay: number;
  event: PlanEvent;
}

/** How long each trace step "runs" in the fake stream. Steps not listed run for 900ms. */
const RUN_MS: Record<string, number> = { resolve: 800, score: 1700, profile: 1200, momentum: 800, route: 1000, openers: 1400, places: 1100, explain: 900 };

/**
 * Turns a finished plan into a PlanEvent stream with realistic delays, for the `?demo=1` mode of /run.
 * Each step is emitted twice (running, then complete), the data events land when their step completes,
 * and the city cards arrive in route order once the last step is done.
 */
export function buildReplay(plan: Plan): TimedEvent[] {
  const out: TimedEvent[] = [];
  const t0 = 1_700_000_000_000;
  let clock = 0;
  const push = (delay: number, event: PlanEvent) => out.push({ delay, event });

  for (const step of plan.trace) {
    const run = RUN_MS[step.id] ?? 900;
    const running: TraceStep = { ...step, calls: [], summary: "", startedAt: t0 + clock, endedAt: undefined };
    push(250, { type: "step", step: running });
    clock += run;
    const done: TraceStep = { ...step, startedAt: t0 + clock - run, endedAt: t0 + clock };
    switch (step.id) {
      case "resolve":
        push(run, { type: "act", act: plan.act });
        push(0, { type: "step", step: done });
        break;
      case "score":
        push(run, { type: "candidates", candidates: plan.candidates });
        push(0, { type: "step", step: done });
        break;
      case "momentum":
        push(run, { type: "momentum", momentum: plan.momentum });
        push(0, { type: "step", step: done });
        break;
      default:
        push(run, { type: "step", step: done });
    }
  }
  plan.stops.forEach((stop, i) => push(i === 0 ? 250 : 90, { type: "stop", stop }));
  push(900, { type: "done", plan });
  return out;
}
