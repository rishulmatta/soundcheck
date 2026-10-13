/**
 * Entry point for the Qloo tool layer.
 *
 * getQloo() returns the deterministic mock when QLOO_MOCK === "1" or when QLOO_API_KEY is missing (one warning is
 * logged in the latter case), otherwise the live client against QLOO_BASE_URL (default https://hackathon.api.qloo.com).
 * Server-only: never import this from a client component.
 */
import type { QlooClient } from "./contract";
import { DEFAULT_QLOO_BASE_URL } from "./client";
import { LiveQlooClient } from "./live";
import { MockQlooClient } from "./mock";

export type * from "./contract";
export { redactRequest, redactParts, type RedactContext } from "./redact";
export { HEATMAP_TOP_N, aggregateHeatmap } from "./schemas";
export { INSIGHTS_TYPE, SEARCH_TYPE, locationQueryFor } from "./live";

let instance: QlooClient | null = null;
let instanceMode: "live" | "mock" | null = null;
let warned = false;

export function qlooMode(): "live" | "mock" {
  return process.env.QLOO_MOCK === "1" || !process.env.QLOO_API_KEY ? "mock" : "live";
}

export function getQloo(): QlooClient {
  const mode = qlooMode();
  if (instance && instanceMode === mode) return instance;
  if (mode === "mock") {
    if (process.env.QLOO_MOCK !== "1" && !warned) {
      warned = true;
      console.warn("[qloo] QLOO_API_KEY is not set; using the synthetic mock client. Set QLOO_MOCK=1 to silence this.");
    }
    instance = new MockQlooClient();
  } else {
    instance = new LiveQlooClient({
      apiKey: process.env.QLOO_API_KEY as string,
      baseUrl: process.env.QLOO_BASE_URL || DEFAULT_QLOO_BASE_URL,
    });
  }
  instanceMode = mode;
  return instance;
}

/** Test hook: forget the memoized client so env changes take effect. */
export function resetQlooForTests(): void {
  instance = null;
  instanceMode = null;
  warned = false;
}

/**
 * Every distinct Qloo call type the client can make, for the trace legend and the write-up's "Qloo depth" table.
 * `features` lists the notable parameters each call exercises.
 */
export const QLOO_CALL_TYPES = [
  {
    id: "search",
    request: "GET /search?query=&types=",
    method: "searchEntity",
    description: "Resolve the act's name to Qloo entity candidates (artist, person, podcast, ...) for confirmation.",
    features: ["types (search-specific type URNs)"],
  },
  {
    id: "tags",
    request: "GET /v2/tags?filter.query=",
    method: "findTags",
    description: "Find valid tag ids for a venue brief or a fallback genre seed (typo-tolerant tag search).",
    features: ["feature.typo_tolerance", "filter.tag.types"],
  },
  {
    id: "insights.heatmap",
    request: "GET /v2/insights?filter.type=urn:heatmap",
    method: "heatmapForCity",
    description: "Score a candidate city: geohash cells of affinity, affinity rank, and popularity for the act within that locality.",
    features: ["filter.location.query", "signal.interests.entities", "signal.interests.tags (fallback)"],
  },
  {
    id: "insights.demographics",
    request: "GET /v2/insights?filter.type=urn:demographics",
    method: "demographics",
    description: "Profile the act's overall audience by age bucket and gender, as scores vs. baseline; not a city-specific profile or demand forecast.",
    features: ["signal.interests.entities", "signal.interests.tags (fallback)"],
  },
  {
    id: "trending",
    request: "GET /v2/trending",
    method: "trending",
    description: "Weekly popularity percentile and rank velocity for the act, to judge momentum and announcement timing.",
    features: ["filter.start_date", "filter.end_date"],
  },
  {
    id: "insights.same-type",
    request: "GET /v2/insights?filter.type=urn:entity:{artist|person|podcast}",
    method: "relatedActs",
    description: "Find related acts of the same type with city signals; local connection, availability and suitability need verification.",
    features: ["signal.location.query", "filter.exclude.entities", "feature.explainability", "take"],
  },
  {
    id: "analysis.compare",
    request: "GET /v2/analysis/compare",
    method: "compareAudiences",
    description: "Compare shared taste scores for the act and candidate opener; Soundcheck derives a similarity index, not a percentage of shared fans.",
    features: ["a.signal.interests.entities", "b.signal.interests.entities"],
  },
  {
    id: "insights.brand",
    request: "GET /v2/insights?filter.type=urn:entity:brand",
    method: "brands",
    description: "Shortlist brands using act-wide taste and age signals; sponsorship interest is unverified.",
    features: ["signal.demographics.age", "feature.explainability"],
  },
  {
    id: "insights.place",
    request: "GET /v2/insights?filter.type=urn:entity:place",
    method: "places",
    description: "Pick local venues for afterparties, pop-ups, or VIP dinners that fit the act's crowd in a city.",
    features: ["filter.location.query", "filter.tags", "filter.popularity.min", "feature.explainability"],
  },
  {
    id: "insights.tag",
    request: "GET /v2/insights?filter.type=urn:tag",
    method: "tasteTags",
    description: "Describe the act's taste profile (genres and cross-domain interests) for copy and tag-seeded fallbacks.",
    features: ["diversify.by=subtype", "diversify.take"],
  },
] as const;

export type QlooCallTypeId = (typeof QLOO_CALL_TYPES)[number]["id"];
