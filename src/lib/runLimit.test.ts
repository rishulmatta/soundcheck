import { describe, expect, it } from "vitest";
import { RunLimiter, limitedResponse } from "./runLimit";

describe("public run budget", () => {
  it("holds capacity until work finishes and releases only once", () => {
    const limiter = new RunLimiter(() => 0);
    const policy = { concurrency: 1, starts: 10, windowMs: 60_000 };
    const first = limiter.acquire("plan", policy);
    expect(first.ok).toBe(true);
    expect(limiter.acquire("plan", policy).ok).toBe(false);
    if (!first.ok) throw new Error("expected admission");
    first.release();
    first.release();
    expect(limiter.acquire("plan", policy).ok).toBe(true);
    expect(limiter.acquire("plan", policy).ok).toBe(false);
  });

  it("counts completed starts, expires the rolling window, and separates proposal budgets", () => {
    let now = 0;
    const limiter = new RunLimiter(() => now);
    const policy = { concurrency: 2, starts: 1, windowMs: 60_000 };
    const first = limiter.acquire("plan", policy);
    if (!first.ok) throw new Error("expected admission");
    first.release();
    now = 10_000;
    expect(limiter.acquire("plan", policy)).toEqual({ ok: false, retryAfter: 50 });
    expect(limiter.acquire("proposal", policy).ok).toBe(true);
    now = 60_000;
    expect(limiter.acquire("plan", policy).ok).toBe(true);
  });

  it("returns a retryable uncached HTTP response", async () => {
    const response = limitedResponse({ ok: false, retryAfter: 23 });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("23");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toHaveProperty("error");
  });
});
