/**
 * Turns a Qloo request URL into the redacted trace string shown in the agent trace and the write-up, e.g.
 *   GET /v2/insights?filter.type=urn:heatmap&filter.location.query=Boise&signal.interests.entities=[act]
 *
 * Always removed: the API key (should it ever appear), entity ids ([act] / [entity]), tag ids ([tags]),
 * locality ids ([locality]), the act name in /search ([act]), and any stray UUID.
 * Kept visible: filter.type, location queries, dates, take, feature flags, demographics buckets, operators.
 */

export type QueryValue = string | number | boolean | readonly string[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/**
 * Percent-encodes a query value but leaves ":" and "," readable. Both are legal in a query component
 * (RFC 3986 pchar / sub-delims), and Qloo URNs and comma-joined id lists stay legible in logs and cache keys.
 */
export function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}

/**
 * Serializes params in insertion order. Arrays are comma-joined, as the Qloo docs specify for GET
 * (`style: form, explode: false`). Empty, null, and undefined values are dropped.
 */
export function buildQueryString(params: QueryParams): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null) continue;
    const value = Array.isArray(raw) ? raw.filter((v) => v !== "").join(",") : String(raw);
    if (value === "") continue;
    parts.push(`${encodeQueryValue(key)}=${encodeQueryValue(value)}`);
  }
  return parts.join("&");
}

export interface RedactContext {
  /** Ids that belong to the act being planned; they render as [act], everything else as [entity]. */
  actIds?: readonly string[];
  method?: string;
}

const KEY_PARAM = /^(x-)?api[-_]?key$|^key$/i;
/** signal.interests.entities, filter.exclude.entities, a./b.signal.interests.entities, filter.results.entities, entity_ids, filter.references_brand */
const ENTITY_PARAM = /(^|\.)(entities|entity_ids|references_brand)$/;
/** signal.interests.tags, filter.tags, filter.exclude.tags, filter.results.tags. (filter.tag.types stays visible.) */
const TAG_PARAM = /(^|\.)tags$/;
const LOCATION_ID_PARAM = /^(filter|signal)(\.exclude)?\.location$/;
/** Without a context, these entity params default to [act]; the b-side of a compare and the rest default to [entity]. */
const ACT_DEFAULT_PARAMS = new Set(["signal.interests.entities", "filter.exclude.entities", "a.signal.interests.entities"]);
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_TEST = new RegExp(UUID_SOURCE, "i");
const UUID_ALL = new RegExp(UUID_SOURCE, "gi");

function redactEntityList(param: string, value: string, ctx: RedactContext): string {
  const ids = value.split(",").map((v) => v.trim()).filter(Boolean);
  const tokens = ids.map((id) => {
    if (ctx.actIds) return ctx.actIds.includes(id) ? "[act]" : "[entity]";
    return ACT_DEFAULT_PARAMS.has(param) ? "[act]" : "[entity]";
  });
  return [...new Set(tokens)].join(",");
}

/**
 * Redacts a request URL (absolute or path-only) into "GET /path?params".
 * Redacted tokens are emitted raw (brackets unencoded); visible values use the same readable encoding as real requests.
 */
export function redactRequest(input: string | URL, ctx: RedactContext = {}): string {
  const url = typeof input === "string" ? new URL(input, "https://redacted.invalid") : input;
  const method = (ctx.method ?? "GET").toUpperCase();
  const parts: string[] = [];

  for (const [param, value] of url.searchParams) {
    const key = encodeQueryValue(param);
    if (KEY_PARAM.test(param)) {
      parts.push(`${key}=[key]`);
    } else if (url.pathname === "/search" && param === "query") {
      parts.push(`${key}=[act]`);
    } else if (ENTITY_PARAM.test(param)) {
      parts.push(`${key}=${redactEntityList(param, value, ctx)}`);
    } else if (TAG_PARAM.test(param)) {
      parts.push(`${key}=[tags]`);
    } else if (LOCATION_ID_PARAM.test(param) && UUID_TEST.test(value)) {
      parts.push(`${key}=[locality]`);
    } else {
      const scrubbed = value.replace(UUID_ALL, "\u0000");
      const encoded = encodeQueryValue(scrubbed).replace(/%00/g, "[entity]");
      parts.push(`${key}=${encoded}`);
    }
  }

  let out = `${method} ${url.pathname}${parts.length ? `?${parts.join("&")}` : ""}`;
  const apiKey = process.env.QLOO_API_KEY;
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join("[key]");
  return out;
}

/** Convenience: redact a request described as path + params (what the client and the mock build). */
export function redactParts(path: string, params: QueryParams, ctx: RedactContext = {}): string {
  const qs = buildQueryString(params);
  return redactRequest(qs ? `${path}?${qs}` : path, ctx);
}
