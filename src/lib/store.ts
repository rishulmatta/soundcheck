/**
 * Plan persistence.
 * - Redis (REDIS_URL on Railway, or Upstash REST) through src/lib/redis.ts when configured: key `plan:<id>`, JSON.
 * - Otherwise an in-memory map plus a JSON file cache under `.cache/plans/<id>.json` (gitignored) so dev restarts keep plans.
 * - `demo-musician` always resolves: when nothing is stored under that id, the bundled sample fixture is served.
 * Server-only. Every read is validated against the Plan schema; unreadable entries are treated as missing.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getKV } from "@/lib/redis";
import { Plan } from "@/lib/types";
import sample from "@/fixtures/plan.sample.json";
import { fetchBackendPlan, getBackendBaseUrl } from "@/lib/backend";

/** Ids of the seeded demos shown on the landing page. */
export const SEEDED_PLAN_IDS = ["demo-musician", "demo-comedian", "demo-podcast"] as const;

const memory = new Map<string, Plan>();
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidPlanId(id: string): boolean {
  return VALID_ID.test(id);
}

const redis = () => getKV();

const fileFor = (id: string) => path.join(process.cwd(), ".cache", "plans", `${id}.json`);

function parsePlan(raw: unknown): Plan | null {
  const parsed = Plan.safeParse(typeof raw === "string" ? safeJson(raw) : raw);
  return parsed.success ? parsed.data : null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function readStored(id: string): Promise<Plan | null> {
  const r = redis();
  if (r) {
    try {
      return parsePlan(await r.get(`plan:${id}`));
    } catch (err) {
      console.warn(`[store] redis get failed for ${id}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  try {
    return parsePlan(await fs.readFile(fileFor(id), "utf8"));
  } catch {
    return null;
  }
}

/** Backend first on the web tier; otherwise memory, Redis or file. No fixture fallback: seed-on-demand uses this. */
export async function getStoredPlan(id: string): Promise<Plan | null> {
  if (!isValidPlanId(id)) return null;
  const backend = getBackendBaseUrl();
  if (backend) {
    const remote = parsePlan(await fetchBackendPlan(id, backend));
    // Do not cache remote snapshots in process memory: edits/deletes on Railway should appear on the next read.
    if (remote?.id === id) return remote;
  }
  const hit = memory.get(id);
  if (hit) return hit;
  const stored = await readStored(id);
  if (stored) memory.set(id, stored);
  return stored;
}

export async function getPlan(id: string): Promise<Plan | null> {
  const stored = await getStoredPlan(id);
  if (stored) return stored;
  if (id === "demo-musician") return parsePlan(sample);
  return null;
}

export async function putPlan(plan: Plan): Promise<void> {
  if (!isValidPlanId(plan.id)) throw new Error(`invalid plan id: ${plan.id}`);
  memory.set(plan.id, plan);
  const r = redis();
  if (r) {
    try {
      await r.set(`plan:${plan.id}`, JSON.stringify(plan));
    } catch (err) {
      console.warn(`[store] redis set failed for ${plan.id}:`, err instanceof Error ? err.message : err);
    }
    return;
  }
  try {
    await fs.mkdir(path.dirname(fileFor(plan.id)), { recursive: true });
    await fs.writeFile(fileFor(plan.id), JSON.stringify(plan, null, 1), "utf8");
  } catch {
    // Read-only filesystems (serverless) keep the in-memory copy only.
  }
}

/** Forget a stored plan everywhere (memory, Redis, file cache). The next read of a seeded id regenerates it. */
export async function deletePlan(id: string): Promise<void> {
  if (!isValidPlanId(id)) return;
  memory.delete(id);
  const r = redis();
  if (r) {
    try {
      await r.del(`plan:${id}`);
    } catch (err) {
      console.warn(`[store] redis del failed for ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  try {
    await fs.unlink(fileFor(id));
  } catch {
    // no file cache entry
  }
}
