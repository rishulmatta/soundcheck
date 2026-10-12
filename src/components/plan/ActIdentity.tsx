import type { Act } from "@/lib/types";
import { cn } from "@/components/ui/cn";

/**
 * The act's picture, one-line description and confirmation links, fetched online when the plan ran.
 * Lets the user check the resolved entity is the one they meant before trusting the plan.
 */
export function ActPortrait({ act, size = 96, className }: { act: Act; size?: number; className?: string }) {
  if (!act.imageUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote hosts vary (Qloo, Wikimedia); plain img with no referrer.
    <img
      src={act.imageUrl}
      alt={`${act.name}`}
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn("shrink-0 rounded-md border border-line bg-bg-raised object-cover sc-fade-in", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function ActLinks({ act, className, print = false }: { act: Act; className?: string; print?: boolean }) {
  if (!act.links.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-2", className)} aria-label="Confirm the act">
      <span className="label mr-1">Confirm</span>
      {act.links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-pill border border-line px-2.5 text-[13px] leading-[18px] text-ink transition-colors duration-150 ease-out hover:border-line-strong hover:bg-bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            print && "border-ink-faint",
          )}
        >
          {l.label}
          <span aria-hidden="true" className="text-ink-muted">↗</span>
        </a>
      ))}
    </div>
  );
}
