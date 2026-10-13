"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ActType, BudgetTier, PlanInput, Region } from "@/lib/types";
import { BUDGET_TIER_HINT, BUDGET_TIER_LABEL } from "@/lib/economics";
import { Button } from "@/components/ui/Button";
import { ArrowRight } from "@/components/ui/icons";
import { MonthRangePicker } from "@/components/ui/MonthRangePicker";
import { formatWindow, type MonthRange } from "@/lib/window";
import { ACT_TYPE_OPTION, REGION_LABEL } from "./format";
import { RUN_INPUT_KEY } from "./runInput";

const fieldCls =
  "h-10 w-full rounded-sm border border-line-strong bg-bg px-3 text-[15px] leading-[22px] text-ink placeholder:text-ink-faint transition-colors duration-150 hover:border-ink-faint";

function Field({ label, htmlFor, hint, className, children }: { label: string; htmlFor: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
      {hint && <p className="text-[13px] leading-[18px] text-ink-muted">{hint}</p>}
    </div>
  );
}

function Select({ id, value, onChange, children }: { id: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldCls} appearance-none pr-9`}>
        {children}
      </select>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-3 top-3">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Custom run: validates a PlanInput, hands it to /run through sessionStorage, and navigates. */
export function LandingForm() {
  const router = useRouter();
  const uid = useId();
  const [actQuery, setActQuery] = useState("");
  const [actType, setActType] = useState<string>("artist");
  const [region, setRegion] = useState<string>("north-america");
  const [stops, setStops] = useState("6");
  const [window_, setWindow] = useState<MonthRange | undefined>({ start: { year: 2027, month: 0 }, end: { year: 2027, month: 2 } });
  const [locked, setLocked] = useState("");
  const [excluded, setExcluded] = useState("");
  const [budgetTier, setBudgetTier] = useState<string>("bus");
  const [error, setError] = useState<string | undefined>();

  const id = (n: string) => `${uid}-${n}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = PlanInput.safeParse({
      actQuery: actQuery.trim(),
      actType: ActType.safeParse(actType).data,
      region: Region.safeParse(region).data,
      stops: Number(stops),
      window: window_ ? formatWindow(window_) : undefined,
      lockedCities: list(locked),
      excludedCities: list(excluded),
      budgetTier: BudgetTier.safeParse(budgetTier).data,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first?.path[0] === "actQuery" ? "Name the act you want to route." : first?.path[0] === "stops" ? "Choose between 3 and 20 stops." : "Check the form and try again.");
      return;
    }
    setError(undefined);
    try {
      sessionStorage.setItem(RUN_INPUT_KEY, JSON.stringify(parsed.data));
    } catch {
      /* private mode: the run page reports the missing input */
    }
    router.push("/run");
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-md border border-line bg-bg-raised p-5 sm:p-6">
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <Field label="Act" htmlFor={id("act")}>
          <input id={id("act")} className={fieldCls} value={actQuery} onChange={(e) => setActQuery(e.target.value)} placeholder="Name a musician or band…" autoComplete="off" aria-invalid={error ? true : undefined} />
        </Field>
        <Field label="Type" htmlFor={id("type")} hint="Musicians are the focus. Other live-act types are experimental.">
          <Select id={id("type")} value={actType} onChange={setActType}>
            {ActType.options.map((o) => (
              <option key={o} value={o} disabled={["book", "video_game", "brand"].includes(o)}>{ACT_TYPE_OPTION[o]}{o === "artist" ? "" : ["person", "podcast"].includes(o) ? " · experimental" : " · coming later"}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-[1fr_120px_1fr]">
        <Field label="Region" htmlFor={id("region")}>
          <Select id={id("region")} value={region} onChange={setRegion}>
            {Region.options.map((o) => (
              <option key={o} value={o}>{REGION_LABEL[o]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Stops" htmlFor={id("stops")}>
          <input id={id("stops")} type="number" min={3} max={20} inputMode="numeric" className={`${fieldCls} num`} value={stops} onChange={(e) => setStops(e.target.value)} />
        </Field>
        <Field label="Window" htmlFor={id("window")} className="sm:col-span-2 md:col-span-1">
          <MonthRangePicker id={id("window")} value={window_} onChange={setWindow} className={fieldCls} />
        </Field>
      </div>
      <details className="group">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-sm text-[13px] font-semibold leading-[18px] text-ink-muted hover:text-ink">
          Advanced: locked cities, exclusions, budget tier
        </summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="Locked cities" htmlFor={id("locked")} hint="Always on the route. Comma separated.">
            <input id={id("locked")} className={fieldCls} value={locked} onChange={(e) => setLocked(e.target.value)} placeholder="Chicago, Austin" />
          </Field>
          <Field label="Excluded cities" htmlFor={id("excluded")} hint="Never routed. Comma separated.">
            <input id={id("excluded")} className={fieldCls} value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="Phoenix" />
          </Field>
          <Field label="Budget tier" htmlFor={id("budget")} hint={`${BUDGET_TIER_HINT[BudgetTier.safeParse(budgetTier).data ?? "bus"]}. Sets the travel-cost assumptions; every rate stays editable on the plan.`} className="sm:col-span-2">
            <Select id={id("budget")} value={budgetTier} onChange={setBudgetTier}>
              {BudgetTier.options.map((o) => (
                <option key={o} value={o}>{BUDGET_TIER_LABEL[o]}</option>
              ))}
            </Select>
          </Field>
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="alert" className="min-h-[22px] text-[13px] leading-[22px] text-danger">{error}</p>
        <Button type="submit" variant="primary" icon={<ArrowRight />} className="flex-row-reverse">Run soundcheck</Button>
      </div>
    </form>
  );
}
