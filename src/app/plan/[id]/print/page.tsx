import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PrintView } from "@/components/plan/PrintView";
import { getPlan } from "@/lib/store";

export const metadata: Metadata = { title: "Tour plan (print) · Soundcheck" };

export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-screen" />}>
      <Print params={params} />
    </Suspense>
  );
}

async function Print({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPlan(id);
  if (!plan) notFound();
  return <PrintView plan={plan} />;
}
