/**
 * Thin fetch wrapper for the Qloo hackathon API.
 *
 * Per the hackathon developer guide (docs.qloo.com/reference/qloo-llm-hackathon-developer-guide):
 *  - base URL https://hackathon.api.qloo.com (staging/production hosts return 401 for hackathon keys)
 *  - auth via the `X-Api-Key` header only (never a query param, never Bearer)
 *  - GET with query-string params; arrays are comma-joined
 * Adds a 15 s timeout, exponential backoff on 429/5xx/network errors (max 3 retries), and a URL-keyed response cache.
 */
import { cacheKey, getQlooCache, type QlooCache } from "./cache";
import { buildQueryString, redactRequest, type QueryParams, type RedactContext } from "./redact";

export const DEFAULT_QLOO_BASE_URL = "https://hackathon.api.qloo.com";

export interface QlooRequest {
  path: string;
  params: QueryParams;
}

export type QlooHttpResult =
  | { ok: true; httpStatus: 200; body: unknown; cached: boolean; ms: number; url: string; request: string; attempts: number }
  | {
      ok: false;
      /** 0 for network/timeout failures. */
      httpStatus: number;
      /** "client" = a 400 the API rejected (bad param, unknown locality); "fatal" = auth/permission/not found/5xx/network. */
      kind: "client" | "fatal";
      message: string;
      cached: false;
      ms: number;
      url: string;
      request: string;
      attempts: number;
    };

export interface QlooHttpOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  cache?: QlooCache;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class QlooHttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: QlooCache;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: QlooHttpOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_QLOO_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.cache = opts.cache ?? getQlooCache();
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
  }

  url(req: QlooRequest): string {
    const qs = buildQueryString(req.params);
    return `${this.baseUrl}${req.path}${qs ? `?${qs}` : ""}`;
  }

  async get(req: QlooRequest, redactCtx: RedactContext = {}): Promise<QlooHttpResult> {
    const started = this.now();
    const url = this.url(req);
    const request = redactRequest(url, redactCtx);
    const key = cacheKey(url);

    const hit = await this.cache.get(key);
    if (hit !== undefined) {
      return { ok: true, httpStatus: 200, body: hit, cached: true, ms: this.now() - started, url, request, attempts: 0 };
    }

    let attempts = 0;
    let lastStatus = 0;
    let lastMessage = "no attempt made";

    while (attempts <= this.maxRetries) {
      attempts += 1;
      let retryAfterMs: number | undefined;
      try {
        const res = await this.fetchWithTimeout(url);
        lastStatus = res.status;
        if (res.ok) {
          const body = await res.json().catch(() => undefined);
          if (body === undefined) {
            lastMessage = "Qloo returned a non-JSON body";
            break;
          }
          await this.cache.set(key, body);
          return { ok: true, httpStatus: 200, body, cached: false, ms: this.now() - started, url, request, attempts };
        }
        lastMessage = await errorMessage(res);
        if (!RETRYABLE(res.status)) {
          return {
            ok: false,
            httpStatus: res.status,
            kind: res.status === 400 ? "client" : "fatal",
            message: lastMessage,
            cached: false,
            ms: this.now() - started,
            url,
            request,
            attempts,
          };
        }
        retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      } catch (err) {
        lastStatus = 0;
        lastMessage = err instanceof Error && err.name === "AbortError" ? `timeout after ${this.timeoutMs} ms` : String(err);
      }
      if (attempts > this.maxRetries) break;
      const backoff = this.baseDelayMs * 2 ** (attempts - 1) + Math.floor(Math.random() * this.baseDelayMs * 0.25);
      await this.sleep(Math.min(retryAfterMs ?? backoff, 10_000));
    }

    return {
      ok: false,
      httpStatus: lastStatus,
      kind: "fatal",
      message: lastMessage,
      cached: false,
      ms: this.now() - started,
      url,
      request,
      attempts,
    };
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; errors?: unknown };
    const msg = parsed.message ?? parsed.error ?? parsed.errors;
    if (msg !== undefined) detail = typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 300);
  } catch {
    // not JSON; keep the raw snippet
  }
  return `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
