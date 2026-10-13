/**
 * POST /api/plan/[id]/propose: read a free-text revision request ("drop Tulsa, add Austin, make it 8 stops") and
 * propose a ChangeSet for the user to confirm. Nothing runs or is stored here; the confirmed change-set is sent to
 * POST /api/plan as { parentId, changes }.
 * Body: { request: string } (1..600 chars; 400 otherwise).
 * Response: 200 RevisionProposal { changes (city ids, no-ops removed), note, unmatched }; 404 when the plan is missing;
 * 503 when no model is configured; 502 when the model call fails.
 */
import { z } from "zod";
import { createAnthropicModel, type RevisionDraft } from "@/lib/agent/model";
import { cityPoolFor } from "@/lib/agent/pool";
import { revisePrompt } from "@/lib/agent/prompts";
import { getPlanOrSeed } from "@/lib/ensureSeed";
import { resolveCities } from "@/lib/revision";
import { matchesCity } from "@/lib/routing";
import { RevisionProposal, type ChangeSet, type CityPoolEntry, type Plan } from "@/lib/types";
import { admitRun, limitedResponse } from "@/lib/runLimit";

const Body = z.object({ request: z.string().trim().min(1).max(600) });
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400, headers: NO_STORE });
  }
  const body = Body.safeParse(raw);
  if (!body.success) {
    return Response.json({ error: "Request must be 1 to 600 characters" }, { status: 400, headers: NO_STORE });
  }

  const { id } = await ctx.params;
  const plan = await getPlanOrSeed(id);
  if (!plan) return Response.json({ error: "Plan not found" }, { status: 404, headers: NO_STORE });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "No model configured" }, { status: 503, headers: NO_STORE });
  const admission = admitRun("proposal");
  if (!admission.ok) return limitedResponse(admission);

  const pool = cityPoolFor(plan.input.region);
  let draft: RevisionDraft;
  try {
    draft = await createAnthropicModel().proposeRevision(revisePrompt(plan, pool, body.data.request), AbortSignal.timeout(20_000));
  } catch (err) {
    console.warn(`[api/plan/${id}/propose] model failed:`, err instanceof Error ? err.message : err);
    return Response.json({ error: "The model could not read that request. Try naming cities from the route." }, { status: 502, headers: NO_STORE });
  } finally {
    admission.release();
  }

  const proposal = RevisionProposal.parse(proposalFromDraft(draft, plan, pool));
  return Response.json(proposal, { headers: NO_STORE });
}

/**
 * Resolves the draft's city names to pool ids and removes every no-op, so the UI only lists real changes: locking a
 * city already locked, unlocking one that is not, dropping one already dropped, restoring one that was never dropped,
 * and stops / window / budget equal to the current values. A city both dropped and locked is treated as a drop.
 * Dropping a pool city that is not on the route is kept: it still keeps the router from picking it.
 */
function proposalFromDraft(draft: RevisionDraft, plan: Pick<Plan, "input" | "stops">, pool: CityPoolEntry[]): RevisionProposal {
  const unmatched: string[] = [];
  const resolve = (names: string[]) => {
    const r = resolveCities(names, pool);
    for (const u of r.unmatched) if (!unmatched.some((x) => x.toLowerCase() === u.toLowerCase())) unmatched.push(u);
    return r.ids;
  };
  const inList = (list: string[], id: string) => {
    const city = pool.find((c) => c.id === id);
    return list.some((k) => k === id || (city !== undefined && matchesCity(city, k)));
  };
  const { lockedCities: locked, excludedCities: excluded } = plan.input;

  const drop = resolve(draft.drop).filter((id) => !inList(excluded, id));
  const lock = resolve(draft.lock).filter((id) => !drop.includes(id) && (!inList(locked, id) || inList(excluded, id)));
  const unlock = resolve(draft.unlock).filter((id) => inList(locked, id) && !lock.includes(id) && !drop.includes(id));
  const restore = resolve(draft.restore).filter((id) => inList(excluded, id) && !drop.includes(id) && !lock.includes(id));

  const changes: ChangeSet = { lock, unlock, drop, restore };
  if (draft.stops !== undefined && draft.stops !== plan.input.stops) changes.stops = draft.stops;
  const window = draft.window?.trim();
  if (window && window !== plan.input.window) changes.window = window;
  if (draft.budgetTier !== undefined && draft.budgetTier !== plan.input.budgetTier) changes.budgetTier = draft.budgetTier;
  return { changes, note: draft.note, unmatched };
}
