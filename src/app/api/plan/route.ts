/**
 * POST /api/plan: run the Soundcheck agent and stream its progress as newline-delimited JSON.
 * Body: RunRequest (zod-validated; 400 with issues on failure): either a PlanInput for an original run, or
 *   { parentId, changes } to revise a stored plan. A revision applies the change-set to the parent's input and runs as a
 *   new plan id with parentId set (404 when the parent is missing); the parent is never modified.
 * Response: application/x-ndjson, one PlanEvent per line; the last line is {"type":"done","plan":...}
 * or, if the run itself fails, {"type":"error","message":...}.
 */
import { isRevisionRequest, PlanInput, RevisionRequest, type PlanEvent, type RunRequest } from "@/lib/types";
import { runPlan, type RunOptions } from "@/lib/agent/run";
import { cityPoolFor } from "@/lib/agent/pool";
import { getPlanOrSeed } from "@/lib/ensureSeed";
import { applyChanges, describeChanges, revisionNote } from "@/lib/revision";

export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  // RunRequest, dispatched on parentId so a bad body reports the branch's own issues instead of one invalid_union.
  const revising = typeof body === "object" && body !== null && "parentId" in body;
  const parsed: { success: true; data: RunRequest } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } = revising
    ? RevisionRequest.safeParse(body)
    : PlanInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid plan input", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }

  let input: PlanInput;
  let revision: Pick<RunOptions, "baseline" | "changes" | "revisionNote"> = {};
  if (isRevisionRequest(parsed.data)) {
    const { parentId, changes } = parsed.data;
    const parent = await getPlanOrSeed(parentId);
    if (!parent) return Response.json({ error: "Parent plan not found" }, { status: 404 });
    const pool = cityPoolFor(parent.input.region);
    input = applyChanges(parent.input, changes, pool);
    revision = { baseline: parent, changes, revisionNote: revisionNote(describeChanges(changes, parent, pool)) };
  } else {
    input = parsed.data;
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: PlanEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      try {
        await runPlan(input, send, { signal: abort.signal, ...revision });
      } catch (err) {
        console.error("[api/plan] run failed:", err);
        send({ type: "error", message: abort.signal.aborted ? "Run cancelled" : "The plan could not be completed. Please try again." });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by a disconnected client
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
