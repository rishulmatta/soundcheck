/** Process-wide budget guard for a single app instance. Saved-plan reads remain available. */
type Lane = "plan" | "proposal";
type Policy = { concurrency: number; starts: number; windowMs: number };
type State = { active: number; started: number[] };
export type Admission = { ok: true; release: () => void } | { ok: false; retryAfter: number };

export class RunLimiter {
  private states = new Map<Lane, State>();
  constructor(private readonly now: () => number = Date.now) {}

  acquire(lane: Lane, policy: Policy): Admission {
    const now = this.now();
    const state = this.states.get(lane) ?? { active: 0, started: [] };
    state.started = state.started.filter((time) => time > now - policy.windowMs);
    this.states.set(lane, state);
    if (state.active >= policy.concurrency) return { ok: false, retryAfter: 15 };
    if (state.started.length >= policy.starts) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((state.started[0] + policy.windowMs - now) / 1000)) };
    }
    state.active++;
    state.started.push(now);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        state.active--;
      },
    };
  }
}

const globalLimits = globalThis as unknown as { __soundcheckRunLimiter?: RunLimiter };
const limiter = (globalLimits.__soundcheckRunLimiter ??= new RunLimiter());
function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function admitRun(lane: Lane): Admission {
  return limiter.acquire(lane, {
    concurrency: lane === "plan" ? positiveInt(process.env.SOUNDCHECK_PLAN_CONCURRENCY, 2) : 3,
    starts: lane === "plan" ? positiveInt(process.env.SOUNDCHECK_PLAN_STARTS, 20) : 60,
    windowMs: 15 * 60 * 1000,
  });
}

export function limitedResponse(admission: Extract<Admission, { ok: false }>): Response {
  return Response.json(
    { error: "Custom planning is busy. Try again shortly, or open a finished plan while you wait." },
    { status: 429, headers: { "Retry-After": String(admission.retryAfter), "Cache-Control": "no-store" } },
  );
}
