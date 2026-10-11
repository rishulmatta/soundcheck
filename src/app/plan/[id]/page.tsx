import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PlanView } from "@/components/plan/PlanView";
import { Skeleton } from "@/components/ui/Skeleton";
import { getPlan } from "@/lib/store";

export const metadata: Metadata = { title: "Tour plan · Soundcheck" };

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PlanFallback />}>
      <Plan params={params} />
    </Suspense>
  );
}

async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlan(id);
  if (!plan) notFound();
  return <PlanView plan={plan} />;
}

function PlanFallback() {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 pt-20 lg:px-12">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-5 w-1/3" />
      <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-12">
        <Skeleton className="h-[460px] min-[900px]:col-span-7" />
        <Skeleton className="h-[460px] min-[900px]:col-span-5" />
      </div>
    </div>
  );
}
