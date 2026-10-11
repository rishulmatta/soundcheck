import { getKV } from "@/lib/redis";
import { qlooMode } from "@/lib/qloo";
import { SEEDED_PLAN_IDS } from "@/lib/store";

/** Operational health: which storage backend and Qloo mode are active. No secrets. */
export async function GET() {
  const kv = getKV();
  let kvStatus: "none" | "ok" | "error" = "none";
  if (kv) {
    try {
      await kv.set("health:ping", String(Date.now()));
      kvStatus = (await kv.get("health:ping")) ? "ok" : "error";
    } catch {
      kvStatus = "error";
    }
  }
  const seeded: Record<string, boolean> = {};
  if (kv && kvStatus === "ok") {
    for (const id of SEEDED_PLAN_IDS) seeded[id] = Boolean(await kv.get(`plan:${id}`));
  }
  return Response.json({
    ok: true,
    seeded,
    kv: kv ? { kind: kv.kind, status: kvStatus } : null,
    redisUrlSet: Boolean(process.env.REDIS_URL),
    qloo: qlooMode(),
    model: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
