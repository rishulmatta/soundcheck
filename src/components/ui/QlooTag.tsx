import { cn } from "./cn";

/** Provenance tag. Once per group, at the group's label, never on every number. */
export function QlooTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-sm border border-signal px-1.5 align-middle text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] text-signal",
        className,
      )}
    >
      Qloo
    </span>
  );
}
