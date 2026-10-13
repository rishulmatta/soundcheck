"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { BudgetTier, RevisionProposal, type Plan } from "@/lib/types";
import { BUDGET_TIER_LABEL } from "@/lib/economics";
import { isReorderOnly } from "@/lib/revision";
import { Button } from "@/components/ui/Button";
import { ChevronDown, X } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { MonthRangePicker } from "@/components/ui/MonthRangePicker";
import { formatWindow, parseWindow } from "@/lib/window";
import { RUN_INPUT_KEY } from "./runInput";
import type { DraftItem, RevisionDraft } from "./useRevisionDraft";

const fieldCls =
  "h-9 w-full rounded-sm border border-line-strong bg-bg px-3 text-[15px] leading-[22px] text-ink placeholder:text-ink-faint transition-colors duration-150 hover:border-ink-faint";

const KIND_TONE: Record<DraftItem["kind"], string> = {
  drop: "border-warn text-warn",
  restore: "border-line-strong text-ink",
  lock: "border-spot text-spot",
  unlock: "border-line-strong text-ink",
  stops: "border-line-strong text-ink",
  window: "border-line-strong text-ink",
  budgetTier: "border-line-strong text-ink",
  order: "border-signal text-signal",
};

/** A field whose text can be mid-edit (empty, out of range) without writing every keystroke into the draft. */
function useEditText(effective: string) {
  const [editing, setEditing] = useState<string | undefined>();
  return {
    value: editing ?? effective,
    start: (v: string) => setEditing(v),
    end: () => setEditing(undefined),
  };
}

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
    </div>
  );
}

type Message = { kind: "note"; note: string; unmatched: string[] } | { kind: "error"; text: string };

/**
 * The revise bar docked under the plan. Free text goes to the model for a proposal; the proposal, the card buttons
 * and the route strip all land in the same draft, shown here as removable chips. Re-run hands the draft to /run.
 */
export function RevisionBar({ plan, draft }: { plan: Plan; draft: RevisionDraft }) {
  const router = useRouter();
  const uid = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | undefined>();
  const [more, setMore] = useState(false);
  const { changes, items, empty, count } = draft;

  const stopsEdit = useEditText(String(changes.stops ?? plan.input.stops));
  const windowText = changes.window ?? plan.input.window;

  async function propose(e: React.FormEvent) {
    e.preventDefault();
    const request = text.trim();
    if (!request || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(plan.id)}/propose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
      });
      if (res.status === 503) {
        setMessage({ kind: "error", text: "Free-text revisions need the model; use the Lock, Drop and drag controls." });
        return;
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        const err = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `The planner returned ${res.status}.`;
        setMessage({ kind: "error", text: err });
        return;
      }
      const parsed = RevisionProposal.safeParse(body);
      if (!parsed.success) {
        setMessage({ kind: "error", text: "The proposal came back in a shape this page cannot read. Try rewording the request." });
        return;
      }
      draft.add(parsed.data.changes);
      setMessage({ kind: "note", note: parsed.data.note, unmatched: parsed.data.unmatched });
      setText("");
    } catch {
      setMessage({ kind: "error", text: "Could not reach the planner. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  function rerun() {
    if (empty || !count) return;
    try {
      sessionStorage.setItem(RUN_INPUT_KEY, JSON.stringify({ parentId: plan.id, changes }));
    } catch {
      /* private mode: /run reports the missing input */
    }
    router.push("/run");
  }

  const discard = () => {
    draft.clear();
    setMessage(undefined);
  };

  const reorderOnly = isReorderOnly(changes, plan);
  const hasDraft = !empty && count > 0;
  const id = (n: string) => `${uid}-${n}`;

  return (
    <section
      aria-label="Revise this plan"
      className="sticky bottom-0 z-30 -mx-4 mt-8 border-t border-line-strong bg-bg/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg/85 lg:-mx-12 lg:px-12 print:hidden"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <form onSubmit={propose} className="flex min-w-[260px] flex-1 flex-col gap-1.5">
            <div className="flex gap-2">
              <label htmlFor={id("req")} className="sr-only">Describe a change to this plan</label>
              <input
                id={id("req")}
                className={fieldCls}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Revise: e.g. swap Tulsa for Austin, make it 9 stops"
                autoComplete="off"
                disabled={busy}
                aria-describedby={message ? id("msg") : undefined}
              />
              <Button type="submit" variant="secondary" size="md" className="h-9! flex-none" disabled={busy || !text.trim()} aria-busy={busy}>
                {busy ? "Proposing…" : "Propose"}
              </Button>
              <Button
                variant="ghost"
                className="h-9! flex-none px-2.5!"
                aria-expanded={more}
                aria-controls={id("more")}
                onClick={() => setMore((m) => !m)}
                icon={<span className={cn("inline-flex transition-transform duration-150", more && "rotate-180")}><ChevronDown /></span>}
              >
                More
              </Button>
            </div>
            <div id={id("msg")} role="status" aria-live="polite" className="empty:hidden">
              {message?.kind === "note" && (
                <>
                  {message.note && <p className="text-[13px] leading-[18px] text-ink-muted">{message.note}</p>}
                  {message.unmatched.length > 0 && <p className="text-[13px] leading-[18px] text-warn">Couldn&rsquo;t find: {message.unmatched.join(", ")}</p>}
                </>
              )}
              {message?.kind === "error" && <p className="text-[13px] leading-[18px] text-warn">{message.text}</p>}
            </div>
          </form>

          {hasDraft && (
            <div className="flex flex-1 basis-full flex-col items-stretch gap-2 min-[900px]:basis-auto min-[900px]:flex-none min-[900px]:items-end">
              <div className="flex flex-wrap items-center gap-2 min-[900px]:justify-end">
                <Button variant="primary" onClick={rerun} className="h-9!">
                  Re-run with {count} {count === 1 ? "change" : "changes"}
                </Button>
                <Button variant="ghost" onClick={discard} className="h-9!">Discard</Button>
              </div>
              <p className="text-xs leading-4 text-ink-muted min-[900px]:max-w-[300px] min-[900px]:text-right">
                {reorderOnly ? "Reorder only: instant" : "Re-plans with Qloo from cache; writes copy only for changed stops"}
              </p>
            </div>
          )}
        </div>

        {hasDraft && (
          <ul aria-label="Pending changes" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
            {items.map((item) => (
              <li key={item.key} className="sc-enter flex-none">
                <span className={cn("inline-flex h-8 items-center gap-1 rounded-full border bg-bg-raised pl-3 pr-1 text-[13px] leading-5", KIND_TONE[item.kind])}>
                  <span className="whitespace-nowrap">{item.text}</span>
                  <button
                    type="button"
                    aria-label={`Remove change: ${item.text}`}
                    onClick={() => draft.remove(item)}
                    className="inline-flex size-6 items-center justify-center rounded-full text-ink-muted hover:bg-bg-sunken hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {more && (
          <div id={id("more")} className="sc-fade grid grid-cols-2 gap-3 sm:grid-cols-[96px_200px_minmax(0,260px)]">
            <Field label="Stops" htmlFor={id("stops")}>
              <input
                id={id("stops")}
                type="number"
                min={3}
                max={20}
                inputMode="numeric"
                className={cn(fieldCls, "num")}
                value={stopsEdit.value}
                onChange={(e) => {
                  stopsEdit.start(e.target.value);
                  const n = Number(e.target.value);
                  if (e.target.value !== "" && Number.isInteger(n) && n >= 3 && n <= 20) draft.setField("stops", n);
                }}
                onBlur={stopsEdit.end}
              />
            </Field>
            <Field label="Budget tier" htmlFor={id("tier")}>
              <div className="relative">
                <select
                  id={id("tier")}
                  className={cn(fieldCls, "appearance-none pr-9")}
                  value={changes.budgetTier ?? plan.input.budgetTier}
                  onChange={(e) => {
                    const t = BudgetTier.safeParse(e.target.value);
                    if (t.success) draft.setField("budgetTier", t.data);
                  }}
                >
                  {BudgetTier.options.map((o) => (
                    <option key={o} value={o}>{BUDGET_TIER_LABEL[o]}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-2.5 text-ink-muted"><ChevronDown /></span>
              </div>
            </Field>
            <Field label="Window" htmlFor={id("window")} className="col-span-2 sm:col-span-1">
              <MonthRangePicker
                id={id("window")}
                value={parseWindow(windowText)}
                text={windowText}
                side="top"
                className={fieldCls}
                onChange={(r) => draft.setField("window", r ? formatWindow(r) : undefined)}
              />
            </Field>
          </div>
        )}
      </div>
    </section>
  );
}
