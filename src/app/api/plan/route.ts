/**
 * POST /api/plan: run the Soundcheck agent and stream its progress as newline-delimited JSON.
 * Body: PlanInput (zod-validated; 400 with issues on failure).
 * Response: application/x-ndjson, one PlanEvent per line; the last line is {"type":"done","plan":...}
 * or, if the run itself fails, {"type":"error","message":...}.
 */
import { PlanInput, type PlanEvent } from "@/lib/types";
import { runPlan } from "@/lib/agent/run";

export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = PlanInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid plan input", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
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
        await runPlan(parsed.data, send, { signal: abort.signal });
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
