"use client";

import { useState } from "react";
import type { Plan, ToolStatus, TraceStep } from "@/lib/types";
import { StatusChip } from "@/components/ui/StatusChip";
import { ChevronRight } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import "@/components/ui/motion.css";

/** The steps the agent runs, in order. Used for the pending rows of a live run. */
export const PLANNED_STEPS: Array<{ id: string; name: string }> = [
  { id: "resolve", name: "Resolve act" },
  { id: "score", name: "Score cities" },
  { id: "profile", name: "Profile overall audience" },
  { id: "momentum", name: "Check momentum" },
  { id: "route", name: "Route tour" },
  { id: "openers", name: "Openers and sponsors" },
  { id: "places", name: "Local activations" },
  { id: "explain", name: "Explain picks" },
];

const dotTone: Record<ToolStatus, string> = {
  ok: "border-ok bg-ok",
  partial: "border-warn bg-warn",
  degraded: "border-warn bg-warn",
  error: "border-danger bg-danger",
  empty: "border-ink-faint bg-ink-faint",
};

function seconds(step: TraceStep): string | undefined {
  if (step.endedAt === undefined) return undefined;
  const s = (step.endedAt - step.startedAt) / 1000;
  return `${s.toFixed(1)}s`;
}

function StepRow({ step, running, open, onToggle }: { step: TraceStep; running: boolean; open: boolean; onToggle: () => void }) {
  const dur = seconds(step);
  const notes = Array.from(new Set(step.calls.flatMap((call) => call.note ? [call.note] : [])));
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="sc-link flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-bg-sunken"
      >
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full border-[1.5px]", running ? "sc-breathe border-spot bg-spot-soft" : dotTone[step.status])}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-5">{step.name}</span>
          {(step.summary || dur) && (
            <span className="num block text-xs leading-4 text-ink-muted">
              {[step.summary, dur].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        {running ? (
          <span className="num shrink-0 text-[11px] leading-4 text-spot">running</span>
        ) : (
          <StatusChip status={step.status} size="sm" className="shrink-0" />
        )}
        <span className={cn("shrink-0 text-ink-muted transition-transform duration-150", open && "rotate-90")}>
          <ChevronRight size={14} />
        </span>
      </button>
      {notes.length > 0 && (
        <ul aria-label="Evidence notes" className="space-y-1 px-3 pb-2.5 text-xs leading-4 text-ink-muted">
          {notes.map((note) => <li key={note}><span className="font-semibold">Evidence note:</span> {note}</li>)}
        </ul>
      )}
      {open && (
        <div className="bg-bg-sunken px-3 py-2">
          {step.calls.length === 0 ? (
            <p className="text-xs leading-4 text-ink-muted">{running ? "Waiting for source data." : "No source calls in this step. Computed locally."}</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {step.calls.map((c, i) => (
                <li key={i} className="border-b border-line pb-2 last:border-b-0 last:pb-0">
                  <code className="num block break-all text-xs leading-4 text-ink-muted">{c.request}</code>
                  <span className="num mt-0.5 block text-[11px] leading-4 text-ink-faint">
                    {c.status} · {c.ms}ms{c.cached ? " · cached" : ""}
                  </span>
                  {c.note && <p className="mt-1 text-xs leading-4 text-ink-muted">{c.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

interface Props {
  steps: TraceStep[];
  /** "rail": the 320px agent rail of the live run. "footer": the collapsed one-line bar on a finished plan. */
  variant?: "rail" | "footer";
  /** Live run: steps without endedAt are running, and planned steps not yet seen show as pending. */
  live?: boolean;
  summary?: Plan["summary"];
  className?: string;
}

export function TraceRail({ steps, variant = "rail", live = false, summary, className }: Props) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(variant === "rail");
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const seen = new Set(steps.map((s) => s.id));
  const pending = live ? PLANNED_STEPS.filter((p) => !seen.has(p.id)) : [];
  const notedSteps = steps.filter((step) => step.calls.some((call) => call.note)).length;
  const limitedSteps = steps.filter((step) => step.status !== "ok").length;

  const list = (
    <ol>
      {steps.map((s) => (
        <StepRow key={s.id} step={s} running={live && s.endedAt === undefined} open={openIds.has(s.id)} onToggle={() => toggle(s.id)} />
      ))}
      {pending.map((p) => (
        <li key={p.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full border-[1.5px] border-line-strong" />
          <span className="text-sm leading-5 text-ink-muted">{p.name}</span>
          <span className="sr-only">pending</span>
        </li>
      ))}
    </ol>
  );

  if (variant === "rail") {
    return (
      <aside aria-label="Agent trace" className={cn("overflow-hidden rounded-md border border-line bg-bg-raised", className)}>
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <h2 className="label">Agent</h2>
          {live && <span className="num text-[11px] leading-4 text-ink-muted">{steps.filter((s) => s.endedAt !== undefined).length}/{PLANNED_STEPS.length} steps</span>}
        </div>
        {list}
      </aside>
    );
  }

  const types = summary?.qlooCallTypes;
  const calls = summary?.qlooCalls;
  const m = summary?.model;
  const cachedShare = m && m.inputTokens > 0 ? Math.round((m.cacheReadTokens / m.inputTokens) * 100) : 0;
  return (
    <section aria-label="Agent trace" className={cn("overflow-hidden rounded-md border border-line bg-bg-raised", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="sc-link flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-bg-sunken"
      >
        <span className={cn("text-ink-muted transition-transform duration-150", expanded && "rotate-90")}>
          <ChevronRight size={16} />
        </span>
        <span className="text-sm font-semibold leading-5">Agent trace</span>
        {summary && (
          <span className="text-[13px] leading-[18px] text-ink-muted">
            <span className="num">{types}</span> recorded call types · <span className="num">{calls}</span> calls
          </span>
        )}
        {summary && <StatusChip status={summary.overallStatus} size="sm" />}
        {m && m.calls > 0 && (
          <span className="text-[13px] leading-[18px] text-ink-muted" title={`${m.id}: ${m.calls} calls, ${m.steps} steps, ${m.inputTokens.toLocaleString("en-US")} input tokens of which ${m.cacheReadTokens.toLocaleString("en-US")} read from cache and ${m.cacheWriteTokens.toLocaleString("en-US")} written to it, ${m.outputTokens.toLocaleString("en-US")} output tokens`}>
            <span className="num">{m.calls}</span> model calls · <span className="num">{Math.round(m.inputTokens / 1000)}k</span> tokens in, <span className="num">{cachedShare}%</span> cached
          </span>
        )}
        <span className="ml-auto text-[13px] leading-[18px] text-ink-muted">{expanded ? "Hide calls" : "Show redacted calls"}</span>
      </button>
      {(notedSteps > 0 || limitedSteps > 0) && (
        <p className="border-t border-line px-4 py-2 text-[13px] leading-[18px] text-ink-muted">
          <span className="font-semibold text-ink">Evidence limitations:</span> {notedSteps} {notedSteps === 1 ? "step has" : "steps have"} source notes; {limitedSteps} {limitedSteps === 1 ? "step has" : "steps have"} incomplete data. Open the trace to inspect the affected decisions.
        </p>
      )}
      {expanded && <div className="sc-fade border-t border-line">{list}</div>}
    </section>
  );
}
