/**
 * Plan persistence. Stub: serves the sample fixture for the seeded musician demo and keeps everything else in memory.
 * The agent workstream replaces this with Upstash Redis when env vars are present, keeping the same exports.
 */
import type { Plan } from "@/lib/types";
import sample from "@/fixtures/plan.sample.json";

const memory = new Map<string, Plan>();

export async function getPlan(id: string): Promise<Plan | null> {
  if (memory.has(id)) return memory.get(id)!;
  if (id === "demo-musician") return sample as unknown as Plan;
  return null;
}

export async function putPlan(plan: Plan): Promise<void> {
  memory.set(plan.id, plan);
}

/** Ids of the seeded demos shown on the landing page. */
export const SEEDED_PLAN_IDS = ["demo-musician", "demo-comedian", "demo-podcast"] as const;
