/**
 * GET /api/plan/[id]: the saved plan as JSON, or 404.
 * GET /api/plan/[id]?stored=1: read stored data only; never seed a missing demo or invoke the agent.
 * DELETE /api/plan/[id]: forget the stored plan so a seeded demo regenerates on its next read.
 *   Guarded by `Authorization: Bearer <SOUNDCHECK_ADMIN_TOKEN>`; answers 404 when no token is configured.
 */
import { timingSafeEqual } from "node:crypto";
import { getPlanOrSeed } from "@/lib/ensureSeed";
import { deletePlan, getStoredPlan, isValidPlanId } from "@/lib/store";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const storedOnly = new URL(request.url).searchParams.get("stored") === "1";
  const plan = await (storedOnly ? getStoredPlan(id) : getPlanOrSeed(id));
  if (!plan) return Response.json({ error: "Plan not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const expected = process.env.SOUNDCHECK_ADMIN_TOKEN;
  if (!expected) return Response.json({ error: "Not found" }, { status: 404 });
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(given, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isValidPlanId(id)) return Response.json({ error: "Plan not found" }, { status: 404 });
  await deletePlan(id);
  return Response.json({ ok: true, id, note: "Next read regenerates seeded demos." }, { headers: { "Cache-Control": "no-store" } });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
