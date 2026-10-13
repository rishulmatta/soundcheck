import Link from "next/link";
import { ArrowRight } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { stagger } from "@/components/ui/stagger";
import { RouteSketch, type SketchPoint } from "./RouteSketch";

export interface DemoCardData {
  id: string;
  kind: string;
  name: string;
  region: string;
  stops: number;
  window: string;
  /** The real route, projected. Absent when the plan has not been generated yet. */
  route?: SketchPoint[];
  heat?: SketchPoint[];
  /** One concrete line from the plan, e.g. "Primed, untapped: Boise, Tulsa, Omaha". */
  highlight?: { label: string; text: string };
}

/** A seeded, pre-computed plan. Opens instantly. Hover raises the border and lifts the route thumbnail 2px. */
export function DemoCard({ demo, index }: { demo: DemoCardData; index: number }) {
  return (
    <li className="sc-enter" style={stagger(index, 40, 200)}>
      <Link
        href={`/plan/${demo.id}`}
        className="sc-link group flex h-full flex-col gap-4 rounded-md border border-line bg-bg-raised p-5 hover:border-line-strong"
      >
        <div className="overflow-hidden rounded-sm bg-bg-sunken">
          {demo.route ? (
            <RouteSketch route={demo.route} heat={demo.heat} width={320} height={140} className="sc-link block h-auto w-full group-hover:-translate-y-0.5" label={`Route sketch for ${demo.name}`} />
          ) : (
            <div className="flex aspect-[320/140] items-center justify-center text-[13px] text-ink-faint">Plan not generated yet</div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <p className="label">{demo.kind}</p>
          <h3 className="font-display text-[32px] font-bold uppercase leading-9 tracking-[0.01em]">{demo.name}</h3>
          <p className="text-[15px] leading-[22px] text-ink-muted">
            {demo.region} · {demo.stops} stops · {demo.window}
          </p>
          {demo.highlight && (
            <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
              <span className="font-semibold text-ink">{demo.highlight.label}:</span> {demo.highlight.text}
            </p>
          )}
        </div>
        <span className="flex items-center gap-2 text-sm font-semibold leading-5 text-ink">
          Open plan
          <span className="sc-link text-ink-muted group-hover:translate-x-0.5 group-hover:text-ink">
            <ArrowRight />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Same footprint as the card, shown while the stored plan streams in. */
export function DemoCardSkeleton() {
  return (
    <li aria-hidden="true" className="flex h-full flex-col gap-4 rounded-md border border-line bg-bg-raised p-5">
      <Skeleton className="aspect-[320/140] w-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-4 w-20" />
    </li>
  );
}
