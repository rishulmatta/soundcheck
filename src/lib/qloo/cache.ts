/**
 * Response cache for Qloo GETs, keyed by the full request URL (the API key travels in a header, never in the key).
 *
 * Redis (REDIS_URL on Railway, or Upstash REST) through src/lib/redis.ts when configured, otherwise an in-memory Map
 * with a size cap. No TTL: the hackathon developer guide allows private server-side caching "with no time limit".
 * Cached values are private runtime data and must never be written into the repo.
 */
import { getKV, type StringKV } from "@/lib/redis";

export interface QlooCache {
  readonly kind: "redis" | "memory";
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/** Insertion-ordered Map used as a small LRU: reads refresh recency, writes evict the oldest entry past the cap. */
export class MemoryCache implements QlooCache {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, unknown>();

  constructor(private readonly maxEntries = 2000) {}

  async get(key: string): Promise<unknown | undefined> {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** Redis-backed cache. Any Redis failure degrades to the in-memory fallback instead of failing the Qloo call. */
export class RedisCache implements QlooCache {
  readonly kind = "redis" as const;
  private warned = false;

  constructor(
    private readonly redis: StringKV,
    private readonly fallback: MemoryCache = new MemoryCache(),
  ) {}

  async get(key: string): Promise<unknown | undefined> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw) as unknown;
    } catch (err) {
      this.warn(err);
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value));
    } catch (err) {
      this.warn(err);
      await this.fallback.set(key, value);
    }
  }

  private warn(err: unknown) {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[qloo-cache] Redis unavailable, using in-memory cache: ${String(err)}`);
  }
}

/** Namespaced key: "qloo:" + full request URL. */
export function cacheKey(url: string): string {
  return `qloo:${url}`;
}

const globalForCache = globalThis as unknown as { __soundcheckQlooCache?: QlooCache };

/** Process-wide cache singleton (kept on globalThis so Next.js dev reloads do not drop it). */
export function getQlooCache(): QlooCache {
  if (globalForCache.__soundcheckQlooCache) return globalForCache.__soundcheckQlooCache;
  const kv = getKV();
  const cache: QlooCache = kv ? new RedisCache(kv) : new MemoryCache();
  globalForCache.__soundcheckQlooCache = cache;
  return cache;
}
