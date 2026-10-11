import { getKV } from "@/lib/redis";
import { qlooMode } from "@/lib/qloo";

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
  return Response.json({
    ok: true,
    kv: kv ? { kind: kv.kind, status: kvStatus } : null,
    redisUrlSet: Boolean(process.env.REDIS_URL),
    qloo: qlooMode(),
    model: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
