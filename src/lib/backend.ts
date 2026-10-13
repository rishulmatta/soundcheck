/** Server-side web-tier configuration. Never expose this environment variable through NEXT_PUBLIC_* or Next env. */
export function getBackendBaseUrl(raw = process.env.SOUNDCHECK_BACKEND_URL): string | null {
  if (typeof window !== "undefined") throw new Error("Backend configuration is server-only");
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("SOUNDCHECK_BACKEND_URL must be an HTTPS origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new Error("SOUNDCHECK_BACKEND_URL must be an HTTPS origin without credentials, a path, query or fragment");
  }
  // A frontend pointed at itself would recursively proxy/fetch its own API. Fail configuration early.
  const frontendHosts = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => host.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase());
  if (frontendHosts.includes(url.host.toLowerCase())) throw new Error("SOUNDCHECK_BACKEND_URL must not point to this frontend");
  return url.origin;
}

/** Reads an existing backend endpoint without forwarding cookies, credentials, API keys or database configuration. */
export async function fetchBackendPlan(id: string, baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<unknown | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/plan/${encodeURIComponent(id)}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json" },
    });
    return response.ok ? await response.json() : null;
  } catch {
    // The caller can use a bundled fixture or its normal not-found UI. Never seed a new plan here.
    return null;
  }
}
