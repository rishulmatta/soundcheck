"use client";

import { useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { Button } from "@/components/ui/Button";
import { QlooTag } from "@/components/ui/QlooTag";
import { StatusChip } from "@/components/ui/StatusChip";
import Link from "next/link";
import { Check, Download, FileText, Link2, Play, Shuffle } from "@/components/ui/icons";
import { ACT_TYPE_LABEL, planParams } from "./format";
import { ActLinks, ActPortrait, hasConfirmedQlooMatch } from "./ActIdentity";

const TREND = { rising: "▲ Rising", flat: "▬ Flat", falling: "▼ Falling", unknown: "Momentum unavailable" } as const;

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) resolve();
    else reject(new Error("copy failed"));
  });
}

/** Share: copies the plan URL, swaps its label to "Copied" for 1.5s. No toast. */
export function ShareButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      variant="secondary"
      icon={copied ? <Check /> : <Link2 />}
      onClick={async () => {
        try {
          await copyText(`${window.location.origin}/plan/${id}`);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked: leave the label as is */
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : "Share"}</span>
    </Button>
  );
}

export function PlanHeader({ plan, comparing, onToggleCompare }: { plan: Plan; comparing: boolean; onToggleCompare: () => void }) {
  const { act, momentum } = plan;
  const { dataMode } = provenanceFor(plan);
  const confirmedMatch = hasConfirmedQlooMatch(plan);
  const subtype = act.subtype ? ` · ${act.subtype}` : "";
  return (
    <header className="flex flex-col gap-6 pb-2 pt-2 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 gap-5">
        <ActPortrait act={act} size={96} className="mt-7 hidden sm:block" />
        <div className="flex min-w-0 flex-col gap-3">
          <p className="label">Tour plan</p>
          {plan.revision !== undefined && plan.revision > 1 && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[15px] leading-[22px]">
              <span className="inline-flex h-[22px] items-center rounded-full bg-spot-soft px-2.5 font-mono text-xs font-medium leading-4 text-spot">Revision {plan.revision}</span>
              {plan.parentId && (
                <Link href={`/plan/${plan.parentId}`} className="rounded-sm text-[13px] leading-[18px] text-signal underline underline-offset-2">
                  from revision {plan.revision - 1}
                </Link>
              )}
              {plan.revisionNote && <span className="text-[13px] leading-[18px] text-ink-muted">{plan.revisionNote}</span>}
            </div>
          )}
          <div className="flex items-start gap-4">
            <ActPortrait act={act} size={64} className="sm:hidden" />
            <h1 className="font-display text-[44px] font-bold uppercase leading-[44px] tracking-[0.01em] sm:text-[64px] sm:leading-[60px]">{act.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] leading-[22px]">
            <span className="text-ink">{ACT_TYPE_LABEL[act.type]}{subtype}</span>
            <StatusChip status={confirmedMatch ? "ok" : "partial"}>{confirmedMatch ? "Qloo match" : dataMode === "mock" ? "synthetic entity" : "identity unverified"}</StatusChip>
            {act.id && <span className="num text-xs leading-4 text-ink-muted">{confirmedMatch ? "Qloo ID" : "Stored ID"} {act.id}</span>}
          </div>
          {act.description && <p className="max-w-[60ch] text-[15px] leading-[22px] text-ink">{act.description}</p>}
          <ActLinks act={act} />
          <p className="text-[15px] leading-[22px] text-ink-muted">{planParams(plan).join(" · ")}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] leading-[22px]">
          <span className="label">Momentum</span>
          <QlooTag />
          {momentum.trend === "unknown" ? (
            <span className="text-ink-muted">Momentum unavailable{momentum.status !== "ok" && <> <StatusChip status={momentum.status} size="sm" /></>}</span>
          ) : (
            <>
              <span className="font-semibold text-signal">{TREND[momentum.trend]}</span>
              {momentum.velocity !== undefined && (
                <span className="text-[13px] leading-[18px] text-ink-muted">
                  {momentum.weeks ? <><span className="num">{momentum.weeks}</span>-week </> : null}rank velocity{" "}
                  <span className="num text-ink">{momentum.velocity > 0 ? "+" : ""}{momentum.velocity.toFixed(2)}</span>
                </span>
              )}
            </>
          )}
        </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <Button variant="primary" href={`/plan/${plan.id}/tour`} icon={<Play />}>Play tour</Button>
        <ShareButton id={plan.id} />
        <Button variant="secondary" href={`/plan/${plan.id}/print`} icon={<FileText />}>PDF</Button>
        <Button variant="secondary" href={`/api/plan/${plan.id}/csv`} download icon={<Download />}>CSV</Button>
        {plan.withoutQloo?.protocolVersion === 2 && (
          <Button variant="secondary" aria-pressed={comparing} onClick={onToggleCompare} icon={<Shuffle />}>
            Without Qloo
          </Button>
        )}
      </div>
    </header>
  );
}
