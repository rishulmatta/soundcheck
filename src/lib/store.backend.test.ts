import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/fixtures/plan.sample.json";

vi.mock("@/lib/redis", () => ({ getKV: () => null }));
vi.mock("node:fs", () => ({ promises: { readFile: vi.fn(async () => { throw new Error("missing"); }) } }));
vi.mock("@/lib/agent/run", () => ({ runPlan: vi.fn() }));

import { getPlan, getStoredPlan } from "./store";
import { getPlanOrSeed } from "./ensureSeed";
import { runPlan } from "./agent/run";

beforeEach(() => {
  vi.stubEnv("SOUNDCHECK_BACKEND_URL", "https://backend.example.com/");
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("web-tier plan reads", () => {
  it("uses the backend for saved plans and reads again instead of retaining stale memory", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...sample, id: "shared-plan" }))
      .mockResolvedValueOnce(Response.json({ ...sample, id: "shared-plan", revision: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getStoredPlan("shared-plan"))?.id).toBe("shared-plan");
    expect((await getPlan("shared-plan"))?.revision).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed and wrong-id remote plans", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ id: "requested" })).mockResolvedValueOnce(Response.json({ ...sample, id: "wrong-id" })));
    expect(await getStoredPlan("requested")).toBeNull();
    expect(await getStoredPlan("requested")).toBeNull();
  });

  it("never runs the local agent when the backend is down; musician gets its labelled fixture, other ids are missing", async () => {
    const fetchMock = vi.fn(async () => new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getPlanOrSeed("demo-musician"))?.id).toBe("demo-musician");
    expect(await getPlanOrSeed("demo-comedian")).toBeNull();
    expect(await getPlanOrSeed("custom-plan")).toBeNull();
    expect(runPlan).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not fetch invalid plan ids", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getStoredPlan("../secret")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
