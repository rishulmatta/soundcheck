import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/fixtures/plan.sample.json";
import { Plan } from "@/lib/types";

vi.mock("@/lib/ensureSeed", () => ({ getPlanOrSeed: vi.fn() }));
vi.mock("@/lib/store", () => ({ getStoredPlan: vi.fn(), deletePlan: vi.fn(), isValidPlanId: vi.fn() }));

import { getPlanOrSeed } from "@/lib/ensureSeed";
import { getStoredPlan } from "@/lib/store";
import { GET } from "./route";

const params = () => ({ params: Promise.resolve({ id: "demo-musician" }) });
beforeEach(() => vi.resetAllMocks());

describe("read-only saved plan API", () => {
  it("returns 404 for a missing stored demo without entering seed-on-demand", async () => {
    vi.mocked(getStoredPlan).mockResolvedValue(null);
    const response = await GET(new Request("https://soundcheck.example/api/plan/demo-musician?stored=1"), params());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getStoredPlan).toHaveBeenCalledExactlyOnceWith("demo-musician");
    expect(getPlanOrSeed).not.toHaveBeenCalled();
  });

  it("returns an existing stored plan without calling the agent-backed getter", async () => {
    const plan = Plan.parse(sample);
    vi.mocked(getStoredPlan).mockResolvedValue(plan);
    const response = await GET(new Request("https://soundcheck.example/api/plan/demo-musician?stored=1"), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(plan);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getPlanOrSeed).not.toHaveBeenCalled();
  });

  it("preserves explicit plan-open behavior when read-only lookup was not requested", async () => {
    vi.mocked(getPlanOrSeed).mockResolvedValue(Plan.parse(sample));
    const response = await GET(new Request("https://soundcheck.example/api/plan/demo-musician"), params());
    expect(response.status).toBe(200);
    expect(getPlanOrSeed).toHaveBeenCalledExactlyOnceWith("demo-musician");
    expect(getStoredPlan).not.toHaveBeenCalled();
  });
});
