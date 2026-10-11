import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TourView } from "@/components/tour/TourView";
import { getPlan } from "@/lib/store";

export const metadata: Metadata = { title: "Map tour · Soundcheck" };

export default function TourPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="fixed inset-0 bg-bg-sunken" aria-busy="true" />}>
      <Tour params={params} />
    </Suspense>
  );
}

async function Tour({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlan(id);
  if (!plan || plan.stops.length === 0) notFound();
  return <TourView plan={plan} />;
}
