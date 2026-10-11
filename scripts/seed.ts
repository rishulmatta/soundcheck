/**
 * Pre-runs the three seeded demos and stores them under their fixed ids.
 *   QLOO_MOCK=1 pnpm dlx tsx scripts/seed.ts            # all seeds
 *   pnpm dlx tsx scripts/seed.ts demo-comedian          # one seed
 * Reads .env.local / .env when present. Stores to Upstash when its env vars are set, else .cache/plans/<id>.json.
 */
import { runPlan } from "../src/lib/agent/run";
import { SEEDS } from "../src/lib/seeds";
import type { PlanEvent } from "../src/lib/types";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

async function main() {
  const only = process.argv.slice(2);
  const seeds = only.length ? SEEDS.filter((s) => only.includes(s.id)) : SEEDS;
  if (!seeds.length) throw new Error(`No seed matches ${only.join(", ")}. Known: ${SEEDS.map((s) => s.id).join(", ")}`);
  for (const seed of seeds) {
    const t0 = Date.now();
    const log = (e: PlanEvent) => {
      if (e.type === "step" && e.step.endedAt) console.log(`  [${e.step.status}] ${e.step.name}: ${e.step.summary}`);
    };
    console.log(`${seed.id}: ${seed.label}`);
    const plan = await runPlan(seed.input, log, { id: seed.id });
    console.log(
      `${plan.id}: ${plan.stops.length} stops, ${plan.summary.qlooCalls} Qloo calls (${plan.summary.qlooCallTypes} types), ` +
        `${plan.summary.untappedStops} untapped, status ${plan.summary.overallStatus}, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
