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
  { id: "profile", name: "Profile markets" },
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
      {open && (
        <div className="bg-bg-sunken px-3 py-2">
          {step.calls.length === 0 ? (
            <p className="text-xs leading-4 text-ink-muted">{running ? "Waiting for Qloo." : "No Qloo calls in this step. Computed locally."}</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {step.calls.map((c, i) => (
                <li key={i} className="border-b border-line pb-2 last:border-b-0 last:pb-0">
                  <code className="num block break-all text-xs leading-4 text-ink-muted">{c.request}</code>
                  <span className="num mt-0.5 block text-[11px] leading-4 text-ink-faint">
                    {c.status} · {c.ms}ms{c.cached ? " · cached" : ""}
                  </span>
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
            <span className="num">{types}</span> Qloo call types · <span className="num">{calls}</span> calls
          </span>
        )}
        {summary && <StatusChip status={summary.overallStatus} size="sm" />}
        <span className="ml-auto text-[13px] leading-[18px] text-ink-muted">{expanded ? "Hide calls" : "Show redacted calls"}</span>
      </button>
      {expanded && <div className="sc-fade border-t border-line">{list}</div>}
    </section>
  );
}
