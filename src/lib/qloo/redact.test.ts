import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQueryString, redactParts, redactRequest } from "./redact";
import { qlooRequests } from "./live";

const ACT = "B8BEE72B-B321-481F-B81A-A44881D094D6";
const OTHER = "1FFFE559-16A2-4B66-9988-7091331B75B7";

describe("redactRequest", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders the heatmap trace exactly as the agent trace expects", () => {
    const url = `https://hackathon.api.qloo.com/v2/insights?filter.type=urn:heatmap&filter.location.query=Boise&signal.interests.entities=${ACT}`;
    expect(redactRequest(url)).toBe("GET /v2/insights?filter.type=urn:heatmap&filter.location.query=Boise&signal.interests.entities=[act]");
  });

  it("matches the builder output for the heatmap call", () => {
    const req = qlooRequests.heatmap({ entityIds: [ACT] }, "Boise");
    expect(redactParts(req.path, req.params, { actIds: [ACT] })).toBe(
      "GET /v2/insights?filter.type=urn:heatmap&filter.location.query=Boise&signal.interests.entities=[act]&take=50",
    );
  });

  it("keeps spaces encoded, dates, take, and feature flags visible", () => {
    const req = qlooRequests.related(ACT, "artist", { locationQuery: "Salt Lake City", take: 10, explain: true });
    expect(redactParts(req.path, req.params, { actIds: [ACT] })).toBe(
      "GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=[act]&signal.location.query=Salt%20Lake%20City&filter.exclude.entities=[act]&take=10&feature.explainability=true",
    );
    const trend = qlooRequests.trending(ACT, "artist", 8, new Date("2026-10-12T12:00:00Z"));
    expect(redactParts(trend.path, trend.params)).toBe(
      "GET /v2/trending?filter.type=urn:entity:artist&signal.interests.entities=[act]&filter.start_date=2026-08-17&filter.end_date=2026-10-12",
    );
  });

  it("labels act vs other entities and hides tag ids", () => {
    const cmp = qlooRequests.compare(ACT, OTHER, "artist");
    expect(redactParts(cmp.path, cmp.params, { actIds: [ACT] })).toBe(
      "GET /v2/analysis/compare?a.signal.interests.entities=[act]&b.signal.interests.entities=[entity]&filter.type=urn:entity:artist",
    );
    const places = qlooRequests.places(ACT, {
      locationQuery: "Tulsa",
      tagIds: ["urn:tag:genre:place:bar", "urn:tag:ambience:qloo:lively"],
      minPopularity: 0.5,
      take: 10,
    });
    expect(redactParts(places.path, places.params, { actIds: [ACT] })).toBe(
      "GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=[act]&filter.location.query=Tulsa&filter.tags=[tags]&filter.popularity.min=0.5&take=10",
    );
  });

  it("hides the act name on /search but keeps tag search text", () => {
    expect(redactParts("/search", { query: "The Example Band", types: "urn:entity:artist", take: 5 })).toBe(
      "GET /search?query=[act]&types=urn:entity:artist&take=5",
    );
    expect(redactParts("/v2/tags", { "filter.query": "afterparty", "feature.typo_tolerance": true })).toBe(
      "GET /v2/tags?filter.query=afterparty&feature.typo_tolerance=true",
    );
  });

  it("never leaks the API key, key-like params, locality ids, or stray UUIDs", () => {
    vi.stubEnv("QLOO_API_KEY", "sk-super-secret-1234");
    const out = redactRequest(
      `https://x.test/v2/insights?api_key=sk-super-secret-1234&filter.location=${OTHER}&filter.results.entities.query=${ACT}&note=sk-super-secret-1234`,
    );
    expect(out).not.toContain("sk-super-secret-1234");
    expect(out).not.toContain(ACT);
    expect(out).not.toContain(OTHER);
    expect(out).toContain("api_key=[key]");
    expect(out).toContain("filter.location=[locality]");
  });

  it("comma-joins arrays and drops empty params", () => {
    expect(buildQueryString({ a: ["x", "y"], b: undefined, c: [], d: "", e: 0, f: false })).toBe("a=x,y&e=0&f=false");
  });
});
