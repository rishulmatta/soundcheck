/**
 * Seed-on-demand: when a seeded demo id has no stored plan yet (fresh deploy, empty Redis), run it once and store it.
 * Concurrent requests for the same id share one run. Server-only.
 */
import { runPlan } from "@/lib/agent/run";
import { seedById } from "@/lib/seeds";
import { getPlan, getStoredPlan } from "@/lib/store";
import type { Plan } from "@/lib/types";
import { getBackendBaseUrl } from "@/lib/backend";

const g = globalThis as unknown as { __soundcheckSeeding?: Map<string, Promise<Plan | null>> };
const inflight = (g.__soundcheckSeeding ??= new Map());

export async function getPlanOrSeed(id: string): Promise<Plan | null> {
  // Vercel renders the web tier; Railway owns the agent and persistence. An upstream outage must never trigger a
  // local paid/model run or create a second database of plans. getPlan provides the musician fixture or null.
  if (getBackendBaseUrl()) return getPlan(id);
  const seed = seedById(id);
  if (!seed) return getPlan(id);
  const existing = await getStoredPlan(id);
  if (existing) return existing;
  let p = inflight.get(id);
  if (!p) {
    p = runPlan(seed.input, () => undefined, { id })
      .catch(async (err) => {
        console.warn(`[seed] ${id} failed:`, err instanceof Error ? err.message : err);
        return getPlan(id); // the bundled fixture for demo-musician, null otherwise
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}
