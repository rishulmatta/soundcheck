import Link from "next/link";
import { ArrowRight } from "@/components/ui/icons";
import { stagger } from "@/components/ui/stagger";
import { RouteSketch, type SketchPoint } from "./RouteSketch";

export interface DemoCardData {
  id: string;
  kind: string;
  name: string;
  region: string;
  stops: number;
  window: string;
  route: SketchPoint[];
  heat?: SketchPoint[];
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
          <RouteSketch route={demo.route} heat={demo.heat} width={320} height={140} className="sc-link block h-auto w-full group-hover:-translate-y-0.5" label={`Route sketch for ${demo.name}`} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <p className="label">{demo.kind}</p>
          <h3 className="font-display text-[32px] font-bold uppercase leading-9 tracking-[0.01em]">{demo.name}</h3>
          <p className="text-[15px] leading-[22px] text-ink-muted">{demo.region}</p>
          <p className="text-[15px] leading-[22px] text-ink-muted">
            {demo.stops} stops · {demo.window}
          </p>
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
