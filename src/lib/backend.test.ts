import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBackendPlan, getBackendBaseUrl } from "./backend";

afterEach(() => vi.unstubAllEnvs());

describe("backend origin", () => {
  it("keeps the original local architecture when unset and normalizes an HTTPS origin", () => {
    expect(getBackendBaseUrl("")).toBeNull();
    expect(getBackendBaseUrl("  https://soundcheck.example.com///  ")).toBe("https://soundcheck.example.com");
  });

  it.each(["http://example.com", "not a url", "https://user:password@example.com", "https://example.com/api", "https://example.com?key=secret", "https://example.com#fragment"])("rejects unsafe or ambiguous backend configuration %s", (url) => {
    expect(() => getBackendBaseUrl(url)).toThrow(/HTTPS origin/);
  });

  it("rejects a frontend origin that would proxy requests to itself", () => {
    vi.stubEnv("VERCEL_URL", "soundcheck-preview.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "soundcheck.vercel.app");
    expect(() => getBackendBaseUrl("https://soundcheck.vercel.app/")).toThrow(/must not point/);
    expect(() => getBackendBaseUrl("https://soundcheck-preview.vercel.app")).toThrow(/must not point/);
  });
});

describe("backend reads", () => {
  it("requests read-only storage lookup with no-store, a bounded timeout, and no forwarded secrets or redirects", async () => {
    const mockFetch = vi.fn(async () => Response.json({ id: "a-plan" }));
    expect(await fetchBackendPlan("a-plan", "https://backend.example.com", mockFetch)).toEqual({ id: "a-plan" });
    expect(mockFetch).toHaveBeenCalledWith("https://backend.example.com/api/plan/a-plan?stored=1", {
      cache: "no-store", redirect: "error", signal: expect.any(AbortSignal), headers: { Accept: "application/json" },
    });
  });

  it("returns null for unavailable, missing or malformed upstream responses", async () => {
    for (const response of [new Response("missing", { status: 404 }), new Response("outage", { status: 503 }), new Response("not-json")]) {
      expect(await fetchBackendPlan("id", "https://backend.example.com", vi.fn(async () => response))).toBeNull();
    }
    expect(await fetchBackendPlan("id", "https://backend.example.com", vi.fn(async () => { throw new Error("offline"); }))).toBeNull();
  });
});
