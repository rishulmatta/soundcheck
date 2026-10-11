import { describe, expect, it } from "vitest";
import { Plan } from "@/lib/types";
import sample from "./plan.sample.json";

describe("sample plan fixture", () => {
  it("matches the Plan schema", () => {
    const parsed = Plan.safeParse(sample);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 5));
    expect(parsed.success).toBe(true);
  });
});
