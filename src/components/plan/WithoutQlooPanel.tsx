import type { Plan } from "@/lib/types";
import { getCityPool } from "@/data/cities";
import { matchesCity } from "@/lib/routing";
import { provenanceFor } from "@/lib/provenance";
import { validateWithoutQloo } from "@/lib/agent/comparison";
import { StopMarker } from "@/components/ui/StopMarker";

const REGION = { "north-america": "North America", "uk-ireland": "UK and Ireland", europe: "Europe" };
const BUDGET = { van: "Van and trailer", bus: "Bus and truck", production: "Full production" };

/** A disclosed shortlist comparison, not evidence that either method predicts ticket sales. */
export function WithoutQlooPanel({ plan }: { plan: Plan }) {
  if (plan.withoutQloo?.protocolVersion !== 2) return null;
  const pool = getCityPool(plan.input.region);
  const validated = validateWithoutQloo(plan.withoutQloo, plan.input, pool);
  if (!validated.ok) return null;
  const w = validated.value;
  const grounded = new Set(plan.stops.map((s) => s.city.name));
  const plain = new Set(w.cities);
  const shared = w.cities.filter((city) => grounded.has(city)).length;
  const cityLabel = (key: string) => pool.find((city) => matchesCity(city, key))?.name ?? key;
  const mode = provenanceFor(plan).dataMode;
  const source = mode === "live" ? "Soundcheck with Qloo" : mode === "mock" ? "Soundcheck with synthetic fixtures" : "Soundcheck · source unverified";
  return (
    <section aria-labelledby="compare-title" className="sc-enter rounded-md border border-line bg-bg-raised p-4 sm:p-5">
      <h2 id="compare-title" className="font-display text-[26px] font-semibold leading-7">Without Qloo</h2>
      <p className="mb-3 mt-2 text-[13px] leading-[18px] text-ink-muted">
        Same model and supplied planning brief. The baseline uses one model call without external tools;
        Soundcheck uses tools, routing and additional calls. Execution and token budgets are not matched.
      </p>
      <details className="mb-4 rounded-md border border-line px-3 py-2 text-[13px] leading-[18px]">
        <summary className="cursor-pointer text-ink">Shared brief and comparison limits</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-muted">
          <dt>Act</dt><dd>{plan.input.actQuery}</dd>
          <dt>Route</dt><dd>{plan.input.stops} stops · {REGION[plan.input.region]}</dd>
          <dt>Touring setup</dt><dd>{BUDGET[plan.input.budgetTier]}</dd>
          <dt>Window</dt><dd>{plan.input.window || "Not specified"}</dd>
          <dt>Locked</dt><dd>{plan.input.lockedCities.map(cityLabel).join(", ") || "None"}</dd>
          <dt>Excluded</dt><dd>{plan.input.excludedCities.map(cityLabel).join(", ") || "None"}</dd>
          {plan.input.order?.length ? <><dt>Requested order</dt><dd>{plan.input.order.map(cityLabel).join(" → ")}</dd></> : null}
        </dl>
        <p className="mt-3 text-ink-muted">
          Both prompts receive the same candidate pool and planning objective. The baseline is checked for city count,
          distinct cities, pool membership, locked cities and exclusions. Window feasibility, spending limits,
          opener availability and ticket demand are not validated by this comparison.
        </p>
      </details>
      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <div className="rounded-md border border-line p-4">
          <p className="label mb-2">Model without Qloo tools</p>
          <ol className="flex flex-col gap-1">
            {w.cities.map((c, i) => (
              <li key={c} className="flex items-center gap-2.5 text-[15px] leading-[22px]">
                <span className="num w-5 text-right text-xs text-ink-muted">{i + 1}</span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
          {w.openers.length > 0 && (
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              <span className="label mr-2">Possible openers</span>
              {w.openers.join(" · ")}
            </p>
          )}
          <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">{w.note}</p>
        </div>
        <div className="rounded-md border border-line p-4">
          <p className="label mb-2">{source}</p>
          <ol className="flex flex-col gap-1">
            {plan.stops.map((s) => (
              <li key={s.order} className="flex items-center gap-2.5 text-[15px] leading-[22px]">
                <StopMarker n={s.order} size={20} />
                <span>{s.city.name}</span>
                {!plain.has(s.city.name) && <span className="text-xs leading-4 text-ink-muted">different selection</span>}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
            Taste signals inform research leads for openers, brands and places. City rankings use an unverified
            comparison heuristic; availability and audience demand remain unknown.
          </p>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
        {shared} {shared === 1 ? "city appears" : "cities appear"} in both shortlists. Different selections do not
        demonstrate better decisions or higher ticket sales. This is an illustrative comparison, not a benchmark result.
      </p>
    </section>
  );
}
