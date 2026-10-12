/**
 * Act profile: a picture, a one-line description and outbound links so the user can confirm the resolved act is the one
 * they meant. Fetched online at run time, never stored in the repo:
 *  1. Qloo's entity (image, short description, `external` ids) when the live API returned them.
 *  2. Wikipedia (REST search + page summary) and Wikidata (official site, Spotify, Apple Podcasts, YouTube, Instagram, X, IMDb)
 *     as a free fallback, which also works in QLOO_MOCK mode.
 * Results are cached in the KV store under `profile:v1:<type>:<name>`. Never throws; returns null when nothing was found.
 */
import { getKV } from "@/lib/redis";
import type { ActLink, ActType } from "@/lib/types";

export interface ActProfile {
  imageUrl?: string;
  description?: string;
  links: ActLink[];
  source: "wikipedia";
}

const UA = "Soundcheck/0.1 (tour planning demo; https://github.com/rishulmatta/soundcheck)";
const TIMEOUT_MS = 6000;

/** Words in a Wikipedia short description that mark the right kind of page for each act type. */
const TYPE_WORDS: Record<ActType, RegExp> = {
  artist: /\b(band|musician|singer|rapper|songwriter|duo|trio|group|composer|producer|dj|music)\b/i,
  person: /\b(comedian|comic|humorist|actor|actress|entertainer|writer|presenter)\b/i,
  podcast: /\bpodcast/i,
  book: /\b(novel|book|memoir)\b/i,
  video_game: /\bvideo game\b/i,
  brand: /\b(company|brand|manufacturer|retailer|corporation)\b/i,
};

/** Wikidata properties worth a link, in display order. Each maps a claim value to a URL. */
const WIKIDATA_LINKS: { prop: string; label: string; url: (v: string) => string }[] = [
  { prop: "P856", label: "Official site", url: (v) => v },
  { prop: "P1902", label: "Spotify", url: (v) => `https://open.spotify.com/artist/${v}` },
  { prop: "P5842", label: "Apple Podcasts", url: (v) => `https://podcasts.apple.com/podcast/id${v}` },
  { prop: "P2397", label: "YouTube", url: (v) => `https://www.youtube.com/channel/${v}` },
  { prop: "P2003", label: "Instagram", url: (v) => `https://www.instagram.com/${v}` },
  { prop: "P2002", label: "X", url: (v) => `https://x.com/${v}` },
  { prop: "P345", label: "IMDb", url: (v) => (v.startsWith("tt") ? `https://www.imdb.com/title/${v}/` : `https://www.imdb.com/name/${v}/`) },
];

interface WikiSearchPage { key?: string; title?: string; description?: string | null }
interface WikiSummary {
  title?: string;
  description?: string;
  extract?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
  wikibase_item?: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const s = signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: s });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Pick the search hit that looks like the right kind of page: type words in its description first, else the first non-disambiguation hit. */
export function pickWikiPage(pages: WikiSearchPage[], type: ActType): WikiSearchPage | undefined {
  const usable = pages.filter((p) => p.key && !/disambiguation/i.test(p.description ?? ""));
  return usable.find((p) => TYPE_WORDS[type].test(p.description ?? "")) ?? usable[0];
}

/** First sentence of the summary extract, trimmed to about 180 characters. */
export function firstSentence(text: string | undefined, max = 180): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, " ").trim();
  const m = clean.match(/^.+?[.!?](?=\s|$)/);
  const s = (m ? m[0] : clean).trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Links from a Wikidata entity's claims, in WIKIDATA_LINKS order. */
export function linksFromWikidataClaims(claims: Record<string, unknown> | undefined): ActLink[] {
  if (!claims) return [];
  const out: ActLink[] = [];
  for (const { prop, label, url } of WIKIDATA_LINKS) {
    const arr = claims[prop];
    if (!Array.isArray(arr)) continue;
    const v = arr
      .map((c) => (c as { mainsnak?: { datavalue?: { value?: unknown } } })?.mainsnak?.datavalue?.value)
      .find((x): x is string => typeof x === "string" && x.length > 0);
    if (v) out.push({ label, url: url(v) });
  }
  return out;
}

async function fetchFromWikipedia(name: string, type: ActType, signal?: AbortSignal): Promise<ActProfile | null> {
  const q = type === "podcast" && !/podcast/i.test(name) ? `${name} podcast` : name;
  const search = await getJson<{ pages?: WikiSearchPage[] }>(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=5`, signal);
  const page = pickWikiPage(search?.pages ?? [], type);
  if (!page?.key) return null;
  const summary = await getJson<WikiSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`, signal);
  if (!summary) return null;
  const links: ActLink[] = [];
  const wikiUrl = summary.content_urls?.desktop?.page;
  if (wikiUrl) links.push({ label: "Wikipedia", url: wikiUrl });
  if (summary.wikibase_item) {
    const wd = await getJson<{ entities?: Record<string, { claims?: Record<string, unknown> }> }>(
      `https://www.wikidata.org/wiki/Special:EntityData/${summary.wikibase_item}.json`,
      signal,
    );
    links.push(...linksFromWikidataClaims(wd?.entities?.[summary.wikibase_item]?.claims));
  }
  const imageUrl = summary.thumbnail?.source ?? summary.originalimage?.source;
  const description = firstSentence(summary.extract) ?? summary.description;
  if (!imageUrl && !description && links.length === 0) return null;
  return { imageUrl, description, links, source: "wikipedia" };
}

const cacheKey = (name: string, type: ActType) => `profile:v1:${type}:${name.trim().toLowerCase()}`;

/** Online lookup with KV cache. Null when nothing useful was found or the network is unavailable. */
export async function fetchActProfile(name: string, type: ActType, signal?: AbortSignal): Promise<ActProfile | null> {
  if (!name.trim()) return null;
  const kv = getKV();
  const key = cacheKey(name, type);
  if (kv) {
    try {
      const hit = await kv.get(key);
      if (hit) return JSON.parse(hit) as ActProfile | null;
    } catch {
      // cache miss on error
    }
  }
  const profile = await fetchFromWikipedia(name, type, signal);
  if (kv && profile) {
    try {
      await kv.set(key, JSON.stringify(profile));
    } catch {
      // best effort
    }
  }
  return profile;
}

/** Qloo `external` ids (spotify, instagram, ...) as links, for live entities. Unknown keys are ignored. */
export function linksFromQlooExternal(external: unknown, website?: string): ActLink[] {
  const out: ActLink[] = [];
  if (website && /^https?:\/\//.test(website)) out.push({ label: "Official site", url: website });
  if (!external || typeof external !== "object") return out;
  const ext = external as Record<string, unknown>;
  const first = (k: string): string | undefined => {
    const v = ext[k];
    const item = Array.isArray(v) ? v[0] : v;
    const id = item && typeof item === "object" ? (item as { id?: unknown }).id : item;
    return typeof id === "string" && id ? id : undefined;
  };
  const map: [string, string, (id: string) => string][] = [
    ["spotify", "Spotify", (id) => `https://open.spotify.com/artist/${id}`],
    ["itunes", "Apple", (id) => `https://music.apple.com/artist/${id}`],
    ["youtube", "YouTube", (id) => `https://www.youtube.com/${id.startsWith("UC") ? `channel/${id}` : id}`],
    ["instagram", "Instagram", (id) => `https://www.instagram.com/${id}`],
    ["twitter", "X", (id) => `https://x.com/${id}`],
    ["facebook", "Facebook", (id) => `https://www.facebook.com/${id}`],
    ["imdb", "IMDb", (id) => (id.startsWith("tt") ? `https://www.imdb.com/title/${id}/` : `https://www.imdb.com/name/${id}/`)],
    ["wikidata", "Wikidata", (id) => `https://www.wikidata.org/wiki/${id}`],
  ];
  for (const [k, label, url] of map) {
    const id = first(k);
    if (id) out.push({ label, url: url(id) });
  }
  return out;
}

/** Merge: what Qloo gave wins; Wikipedia fills gaps and adds links whose label is not already present. */
export function mergeProfile(base: { imageUrl?: string; description?: string; links: ActLink[] }, profile: ActProfile | null) {
  if (!profile) return base;
  const seen = new Set(base.links.map((l) => l.label));
  return {
    imageUrl: base.imageUrl ?? profile.imageUrl,
    description: base.description ?? profile.description,
    links: [...base.links, ...profile.links.filter((l) => !seen.has(l.label))].slice(0, 8),
  };
}
