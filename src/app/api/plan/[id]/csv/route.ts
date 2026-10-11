/** GET /api/plan/[id]/csv: one row per stop, as a CSV download. */
import { getPlanOrSeed } from "@/lib/ensureSeed";
import { planToCsv } from "@/lib/csv";


export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const plan = await getPlanOrSeed(id);
  if (!plan) return new Response("Plan not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const slug = plan.act.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
  return new Response(planToCsv(plan), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="soundcheck-${slug}-${plan.id}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
