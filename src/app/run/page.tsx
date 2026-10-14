"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useState } from "react";
import sample from "@/fixtures/plan.sample.json";
import type { Act, CityScore, Momentum, Plan, PlanEvent, PlanInput, PlanProvenance, Stop, TraceStep } from "@/lib/types";
import { RunRequest, isRevisionRequest } from "@/lib/types";
import { applyChanges } from "@/lib/revision";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusChip } from "@/components/ui/StatusChip";
import { ArrowLeft } from "@/components/ui/icons";
import { stagger } from "@/components/ui/stagger";
import { CityCard } from "@/components/plan/CityCard";
import { useEconomics } from "@/components/plan/RouteEconomics";
import { CityCardSkeleton } from "@/components/plan/CityCardSkeleton";
import { PlanMap, useStopSelection } from "@/components/plan/PlanView";
import { QuadrantChart } from "@/components/plan/QuadrantChart";
import { SiteBar } from "@/components/plan/SiteBar";
import { PLANNED_STEPS, TraceRail } from "@/components/plan/TraceRail";
import { buildReplay } from "@/components/plan/demoReplay";
import { ACT_TYPE_LABEL, REGION_LABEL } from "@/components/plan/format";
import { RUN_INPUT_KEY } from "@/components/plan/runInput";
import { provenanceFor, safePlanForDisplay } from "@/lib/provenance";
import { DataSourceProvider } from "@/components/ui/QlooTag";
import { ProvenanceBanner } from "@/components/plan/ProvenanceBanner";

interface RunState {
  steps: TraceStep[];
  act?: Act;
  candidates: CityScore[];
  momentum?: Momentum;
  stops: Stop[];
  phase: "running" | "done" | "error";
  error?: string;
  plan?: Plan;
  provenance?: PlanProvenance;
}

const initial: RunState = { steps: [], candidates: [], stops: [], phase: "running" };

type Action = PlanEvent | { type: "reset" };

function reduce(state: RunState, a: Action): RunState {
  switch (a.type) {
    case "reset":
      return initial;
    case "provenance":
      return { ...state, provenance: a.provenance };
    case "step": {
      const i = state.steps.findIndex((s) => s.id === a.step.id);
      const steps = i === -1 ? [...state.steps, a.step] : state.steps.map((s, j) => (j === i ? a.step : s));
      return { ...state, steps };
    }
    case "act":
      return { ...state, act: a.act };
    case "candidates":
      return { ...state, candidates: a.candidates };
    case "momentum":
      return { ...state, momentum: a.momentum };
    case "stop":
      return { ...state, stops: [...state.stops.filter((s) => s.order !== a.stop.order), a.stop].sort((x, y) => x.order - y.order) };
    case "done":
      return { ...state, phase: "done", plan: a.plan };
    case "error":
      return { ...state, phase: "error", error: a.message };
  }
}

/** Reads a newline-delimited JSON stream and hands each PlanEvent to `onEvent`. */
async function readEvents(res: Response, onEvent: (e: PlanEvent) => void) {
  if (!res.body) throw new Error("The server sent an empty response.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as PlanEvent);
    } catch {
      /* ignore a malformed line rather than killing the run */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(flush);
  }
  flush(buffer + decoder.decode());
}

export default function RunPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reduce, initial);
  const [attempt, setAttempt] = useState(0);
  const [input, setInput] = useState<PlanInput | undefined>();
  /** Set when this run revises an earlier plan: the parent's id, for the subtitle and the link back. */
  const [parentId, setParentId] = useState<string | undefined>();
  const [demo, setDemo] = useState(false);
  const sel = useStopSelection();

  useEffect(() => {
    const ctrl = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const params = new URLSearchParams(window.location.search);
    const isDemo = params.get("demo") === "1";
    const hold = params.get("hold") === "1";

    const finish = (plan: Plan) => {
      if (!hold) timers.push(setTimeout(() => router.push(`/plan/${plan.id}`), isDemo ? 700 : 500));
    };
    const emit = (e: PlanEvent) => {
      if (ctrl.signal.aborted) return;
      dispatch(e);
      if (e.type === "done") finish(e.plan);
    };

    async function start() {
      await Promise.resolve();
      if (ctrl.signal.aborted) return;
      if (isDemo) {
        const plan = safePlanForDisplay(sample as unknown as Plan);
        setDemo(true);
        setInput(plan.input);
        let at = 0;
        for (const { delay, event } of buildReplay(plan)) {
          at += delay;
          timers.push(setTimeout(() => emit(event), at));
        }
        return;
      }
      let parsed: RunRequest | undefined;
      try {
        const raw = sessionStorage.getItem(RUN_INPUT_KEY);
        parsed = raw ? RunRequest.parse(JSON.parse(raw)) : undefined;
      } catch {
        parsed = undefined;
      }
      if (!parsed) {
        emit({ type: "error", message: "There is no run to start. Choose an act on the home page." });
        return;
      }
      if (isRevisionRequest(parsed)) {
        const { parentId: pid, changes } = parsed;
        setParentId(pid);
        // The parent's input is not part of the request. Best effort: read the parent so the header, map and
        // economics have the revised input while the run streams. The run still works if this fails.
        fetch(`/api/plan/${encodeURIComponent(pid)}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? (r.json() as Promise<Plan>) : undefined))
          .then((parent) => {
            if (parent && !ctrl.signal.aborted) setInput(applyChanges(parent.input, changes, parent.candidates));
          })
          .catch(() => {});
      } else {
        setInput(parsed);
      }
      try {
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `The planner returned ${res.status}.`);
        }
        let sawEnd = false;
        await readEvents(res, (e) => {
          if (e.type === "done" || e.type === "error") sawEnd = true;
          emit(e);
        });
        if (!sawEnd) emit({ type: "error", message: "The connection closed before the plan finished." });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        emit({ type: "error", message: err instanceof Error ? err.message : "The run failed." });
      }
    }
    void start();

    return () => {
      ctrl.abort();
      timers.forEach(clearTimeout);
    };
  }, [attempt, router]);

  const retry = () => {
    dispatch({ type: "reset" });
    setAttempt((n) => n + 1);
  };

  const { steps, act, candidates, stops, momentum } = state;
  const plan: Plan | undefined = useMemo(() => {
    if (!act || !input) return undefined;
    return {
      id: "live",
      provenance: state.provenance,
      createdAt: "",
      input,
      act,
      momentum: momentum ?? { trend: "unknown", status: "empty" },
      candidates,
      stops,
      trace: steps,
      summary: { qlooCallTypes: 0, qlooCalls: steps.reduce((n, s) => n + s.calls.length, 0), untappedStops: stops.filter((s) => s.city.quadrant === "untapped").length, overallStatus: "ok" },
    };
  }, [act, input, momentum, candidates, stops, steps, state.provenance]);

  const econ = useEconomics({ input: input ?? undefined, stops, act: act ?? undefined });
  const wanted = input?.stops ?? 10;
  const doneSteps = steps.filter((s) => s.endedAt !== undefined).length;
  const title = act?.name ?? input?.actQuery;
  const revising = parentId !== undefined;

  return (
    <DataSourceProvider mode={plan ? provenanceFor(plan).dataMode : state.provenance?.dataMode ?? "unknown"}>
    <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 lg:px-12">
      <SiteBar right={demo ? <span className="label">Synthetic replay</span> : undefined} />
      {plan && <ProvenanceBanner plan={plan} className="mb-5" />}
      <div className="mb-6 flex flex-col gap-2 pt-2">
        <p className="label">{state.phase === "error" ? "Soundcheck stopped" : state.phase === "done" ? (revising ? "Revision ready" : "Plan ready") : revising ? "Revising plan" : "Soundcheck running"}</p>
        {title ? (
          <h1 className="font-display text-[40px] font-bold uppercase leading-10 tracking-[0.01em] sm:text-[56px] sm:leading-[56px]">{title}</h1>
        ) : state.phase === "error" ? null : (
          <Skeleton className="h-10 w-72 sm:h-14" />
        )}
        {revising && (
          <p className="text-[15px] leading-[22px] text-ink-muted">
            Revision of <span className="num">{parentId}</span>.{" "}
            <Link href={`/plan/${parentId}`} className="rounded-sm text-signal underline underline-offset-2">Back to that plan</Link>
          </p>
        )}
        {input && (
          <p className="text-[15px] leading-[22px] text-ink-muted">
            {ACT_TYPE_LABEL[input.actType]} · {REGION_LABEL[input.region]} · {input.stops} stops{input.window ? ` · ${input.window}` : ""}
          </p>
        )}
      </div>

      {state.phase === "error" && (
        <div role="alert" className="sc-enter mb-6 flex flex-col gap-3 rounded-md border border-line bg-bg-raised p-5">
          <StatusChip status="error" className="self-start">run failed</StatusChip>
          <p className="text-[15px] leading-[22px]">{state.error}</p>
          <div className="flex flex-wrap gap-2">
            {(input || revising) && <Button variant="primary" onClick={retry}>Retry</Button>}
            <Button variant="secondary" href="/" icon={<ArrowLeft />}>Back to start</Button>
          </div>
        </div>
      )}

      {!(state.phase === "error" && !input && !revising) && (
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <TraceRail steps={state.provenance?.proseVersion === 2 ? steps : steps.map((step) => ({ ...step, summary: "Legacy summary hidden; inspect recorded source calls." }))} live={state.phase === "running"} variant="rail" />
          {state.phase === "running" && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted" aria-live="polite">
              <span className="num">{doneSteps}</span> of <span className="num">{PLANNED_STEPS.length}</span> steps done
            </p>
          )}
          {state.phase === "done" && state.plan && (
            <div className="sc-enter mt-3">
              <Button variant="primary" href={`/plan/${state.plan.id}`}>Open finished plan</Button>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 min-[1280px]:grid-cols-2">
            <div role="region" aria-label="Tour map" className="relative h-[360px] overflow-hidden rounded-md border border-line bg-bg-sunken">
              {plan && candidates.length > 0 ? (
                <div className="sc-fade h-full">
                  <PlanMap plan={plan} selectedStop={sel.mapStop} onSelectStop={sel.toggle} mode="plan" className="h-full w-full" />
                </div>
              ) : (
                <Skeleton className="h-full w-full rounded-none" />
              )}
            </div>
            {candidates.length > 0 ? (
              <QuadrantChart candidates={candidates} stops={stops} comparability={plan ? provenanceFor(plan).heatmapComparability : state.provenance?.heatmapComparability} activeStop={sel.active} selected={sel.selected !== undefined && sel.selected === sel.active} onHoverStop={sel.setHovered} onSelectStop={sel.toggle} className="sc-fade" />
            ) : (
              <div aria-hidden="true" className="rounded-md border border-line bg-bg-raised p-5">
                <Skeleton className="mb-3 h-7 w-56" />
                <Skeleton className="aspect-[440/320] w-full" />
              </div>
            )}
          </div>

          <section aria-label="City by city" className="flex flex-col gap-4">
            {stops.map((stop, i) => (
              <div key={stop.order} className="sc-enter" style={stagger(i, 60)}>
                <CityCard plan={plan} stop={stop} poolSize={candidates.length} selected={sel.selected === stop.order} hovered={sel.hovered === stop.order} onSelect={sel.toggle} onHover={sel.setHovered} breakEven={econ.breakEven.get(stop.order) ? { b: econ.breakEven.get(stop.order)!, units: econ.units, rates: econ.rates } : undefined} />
              </div>
            ))}
            {state.phase === "running" &&
              Array.from({ length: Math.min(3, Math.max(0, wanted - stops.length)) }, (_, i) => <CityCardSkeleton key={`k${i}`} />)}
          </section>
        </div>
      </div>
      )}
    </div>
    </DataSourceProvider>
  );
}
