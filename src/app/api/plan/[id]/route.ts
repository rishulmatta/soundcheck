/** GET /api/plan/[id]: the saved plan as JSON, or 404. */
import { getPlanOrSeed } from "@/lib/ensureSeed";


export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const plan = await getPlanOrSeed(id);
  if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });
  return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
}
