import Link from "next/link";
import { connection } from "next/server";
import sample from "@/fixtures/plan.sample.json";
import type { Plan } from "@/lib/types";
import { provenanceFor } from "@/lib/provenance";
import { DATA_MODE_LABEL } from "@/components/plan/ProvenanceBanner";
import { getPlan } from "@/lib/store";
import { seedById } from "@/lib/seeds";
import { ArrowRight } from "@/components/ui/icons";
import { projectPlan, RouteSketch } from "@/components/plan/RouteSketch";
import { REGION_LABEL } from "@/components/plan/format";
import { HeroMap } from "./HeroMap";

const DEMO_ID = "demo-musician";

interface Caption {
  kind: string;
  name: string;
  meta: string;
  evidence: string;
}

/** The map well with the caption card in its corner. Shared by the live map and the prerendered fallback. */
function HeroFrame({ caption, children }: { caption: Caption; children: React.ReactNode }) {
  return (
    <div className="relative h-[340px] overflow-hidden rounded-md border border-line bg-bg-sunken sm:h-[440px] lg:h-full lg:min-h-[520px]">
      <div className="absolute inset-0">{children}</div>
      <Link
        href={`/plan/${DEMO_ID}`}
        className="sc-link group absolute bottom-4 left-4 flex max-w-[calc(100%-32px)] flex-col gap-0.5 rounded-sm border border-line bg-bg-raised/95 px-4 py-3 hover:border-line-strong"
      >
        <span className="label">{caption.kind}</span>
        <span className="text-xs font-semibold text-warn">{caption.evidence}</span>
        <span className="disp text-[26px] leading-7 text-ink">{caption.name}</span>
        <span className="text-[13px] leading-[18px] text-ink-muted">{caption.meta}</span>
        <span className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold leading-[18px] text-ink">
          Open the plan
          <span className="sc-link text-ink-muted group-hover:translate-x-0.5 group-hover:text-ink">
            <ArrowRight size={14} />
          </span>
        </span>
      </Link>
    </div>
  );
}

function captionFor(plan: Plan): Caption {
  const parts = [REGION_LABEL[plan.input.region], `${plan.stops.length} stops`];
  if (plan.input.window) parts.push(plan.input.window);
  return { kind: "Musician example", name: plan.act.name, meta: parts.join(" · "), evidence: DATA_MODE_LABEL[provenanceFor(plan).dataMode] };
}

/** Prerendered: the bundled sample route as a sketch, captioned from the seed. Replaced by the live map as it streams in. */
export function LandingMapFallback() {
  const seed = seedById(DEMO_ID);
  const sketch = projectPlan(sample as unknown as Plan);
  const caption: Caption = seed
    ? { kind: "Musician example", evidence: "Illustrative route preview", name: seed.input.actQuery, meta: [REGION_LABEL[seed.input.region], `${seed.input.stops} stops`, seed.input.window].filter(Boolean).join(" · ") }
    : { kind: "Musician example", evidence: "Illustrative route preview", name: "Demo", meta: "" };
  return (
    <HeroFrame caption={caption}>
      <RouteSketch route={sketch.route} heat={sketch.heat} width={640} height={400} numbers className="h-full w-full" label="Route sketch" />
    </HeroFrame>
  );
}

/** Request time only: reads the stored demo plan (never generates one) and hands it to the client map. */
export async function LandingMap() {
  await connection();
  const plan = await getPlan(DEMO_ID);
  if (!plan) return <LandingMapFallback />;
  return (
    <HeroFrame caption={captionFor(plan)}>
      <HeroMap plan={plan} />
    </HeroFrame>
  );
}
