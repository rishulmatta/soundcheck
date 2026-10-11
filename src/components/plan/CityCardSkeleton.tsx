import { Skeleton } from "@/components/ui/Skeleton";

/** Placeholder at the final card's size, shown while the agent is still routing. */
export function CityCardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`rounded-md border border-line bg-bg-raised p-5 sm:p-6 ${className ?? ""}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-[26px] rounded-full" />
          <Skeleton className="h-10 w-48" />
        </div>
        <Skeleton className="h-[22px] w-24 rounded-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_1.15fr]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-4 w-32" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-20" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-2 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <Skeleton className="mb-2 h-4 w-16" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}
