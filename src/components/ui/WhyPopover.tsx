"use client";

import { useEffect, useId, useRef, useState } from "react";
import { QlooTag } from "./QlooTag";
import { cn } from "./cn";
import "./motion.css";

/** "why ▸" trigger for a pick. Opens a popover with the Qloo explainability line. Click to open; outside click and Escape close it. */
export function WhyPopover({ title, reason, tags = [], className }: { title: string; reason: string; tags?: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrap} className={cn("relative inline-flex", className)}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Why ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded-sm px-1 text-[13px] leading-[18px] text-ink-muted transition-colors duration-150 hover:text-ink aria-expanded:text-ink"
      >
        why <span aria-hidden="true">▸</span>
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={`Why ${title}`}
          className="sc-popover absolute right-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-md border border-line-strong bg-bg-raised p-3 text-left shadow-popover"
        >
          <p className="label mb-1 flex items-center gap-2">
            Why {title} <QlooTag />
          </p>
          <p className="text-[13px] leading-[18px] text-ink">{reason}</p>
          {tags.length > 0 && <p className="mt-2 text-xs leading-4 text-ink-muted">{tags.join(" · ")}</p>}
        </div>
      )}
    </span>
  );
}
