"use client";
import { useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { DATA_MODE_LABEL } from "@/components/plan/ProvenanceBanner";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Link2, Play } from "@/components/ui/icons";
import type { CardPhase } from "./TourCard";

/** The finale card: replaces the TourCard once the map has pulled back to the whole route. */
export function TourSummary({ plan, phase, onReplay }: { plan: Plan; phase: CardPhase; onReplay: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const share = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (http, iframe): fall back to a transient textarea.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try */
      }
      ta.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  const { dataMode } = provenanceFor(plan);
  const untapped = plan.stops.filter((s) => s.city.quadrant === "untapped").length;

  return (
    <article
      className="tc-card w-full rounded-md border border-line bg-bg-raised px-5 py-4 sm:w-[380px]"
      data-phase={phase}
      aria-label="Tour summary"
      aria-hidden={phase === "hidden" || phase === "out" ? true : undefined}
    >
      <p className="label m-0 mb-1">Tour summary</p>
      <h2 className="disp m-0 mb-3 text-[32px] leading-8">{plan.act.name}</h2>
      <p className="num m-0 mb-1 text-xs leading-5 text-ink">
        {plan.stops.length} stops · {untapped} markets to investigate
      </p>
      <p className="m-0 mb-4 text-xs leading-[18px] text-ink-muted">{DATA_MODE_LABEL[dataMode]}. City comparisons are provisional; validate demand, costs and availability.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<Play size={14} />} onClick={onReplay}>
          Replay
        </Button>
        <Button variant="primary" size="sm" href={`/plan/${plan.id}`} icon={<ArrowRight size={14} />}>
          Open plan
        </Button>
        <Button variant="secondary" size="sm" icon={<Link2 size={14} />} onClick={share} aria-live="polite">
          {copied ? "Copied" : "Share"}
        </Button>
      </div>
    </article>
  );
}
