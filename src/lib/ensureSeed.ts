/**
 * Seed-on-demand: when a seeded demo id has no stored plan yet (fresh deploy, empty Redis), run it once and store it.
 * Concurrent requests for the same id share one run. Server-only.
 */
import { runPlan } from "@/lib/agent/run";
import { seedById } from "@/lib/seeds";
import { getPlan } from "@/lib/store";
import type { Plan } from "@/lib/types";

const g = globalThis as unknown as { __soundcheckSeeding?: Map<string, Promise<Plan | null>> };
const inflight = (g.__soundcheckSeeding ??= new Map());

export async function getPlanOrSeed(id: string): Promise<Plan | null> {
  const existing = await getPlan(id);
  if (existing) return existing;
  const seed = seedById(id);
  if (!seed) return null;
  let p = inflight.get(id);
  if (!p) {
    p = runPlan(seed.input, () => undefined, { id })
      .catch((err) => {
        console.warn(`[seed] ${id} failed:`, err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}
