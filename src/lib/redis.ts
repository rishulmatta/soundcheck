/**
 * One string key-value adapter for everything that persists: the Qloo response cache and the plan store.
 * Backends, in order of preference:
 *  1. REDIS_URL (Railway Redis, any standard Redis) via ioredis
 *  2. UPSTASH_REDIS_REST_URL + TOKEN (or Vercel KV aliases) via the REST client
 *  3. none: callers fall back to memory / files
 * Server-only. Connection problems are reported once and never thrown to callers.
 */
import type { Redis as IORedis } from "ioredis";

export interface StringKV {
  readonly kind: "redis" | "upstash";
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

class IORedisKV implements StringKV {
  readonly kind = "redis" as const;
  constructor(private readonly client: IORedis) {}
  get(key: string) {
    return this.client.get(key);
  }
  async set(key: string, value: string) {
    await this.client.set(key, value);
  }
  async del(key: string) {
    await this.client.del(key);
  }
}

class UpstashKV implements StringKV {
  readonly kind = "upstash" as const;
  constructor(
    private readonly client: { get<T>(k: string): Promise<T | null>; set(k: string, v: string): Promise<unknown>; del(k: string): Promise<unknown> },
  ) {}
  async get(key: string) {
    const v = await this.client.get<unknown>(key);
    if (v === null || v === undefined) return null;
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  async set(key: string, value: string) {
    await this.client.set(key, value);
  }
  async del(key: string) {
    await this.client.del(key);
  }
}

const g = globalThis as unknown as { __soundcheckKV?: StringKV | null };

/** Process-wide singleton (on globalThis so Next.js dev reloads keep one connection). Returns null when no backend is configured. */
export function getKV(): StringKV | null {
  if (g.__soundcheckKV !== undefined) return g.__soundcheckKV;
  g.__soundcheckKV = create();
  return g.__soundcheckKV;
}

function create(): StringKV | null {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    // Lazy require keeps ioredis out of client bundles and out of test runs that never touch Redis.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("ioredis") as typeof import("ioredis");
    // Commands issued before the socket opens are queued (ioredis default), so the first request after boot is not lost.
    // maxRetriesPerRequest keeps a dead Redis from hanging callers; they fall back to memory after two retries.
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      tls: redisUrl.startsWith("rediss://") ? {} : undefined,
    });
    let warned = false;
    client.on("error", (err: Error) => {
      if (warned) return;
      warned = true;
      console.warn(`[redis] ${err.message}`);
    });
    return new IORedisKV(client);
  }
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    return new UpstashKV(new Redis({ url, token }));
  }
  return null;
}

/** Test hook. */
export function resetKVForTests(): void {
  g.__soundcheckKV = undefined;
}
