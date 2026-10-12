/**
 * Basemap: OpenFreeMap "positron" (free vector tiles, no token, OpenStreetMap data), fetched as JSON and
 * recolored to the Soundcheck tokens before MapLibre ever sees it, so there is no flash of the stock style.
 * The map is a ground, not a picture: roads, buildings, parks and POIs are removed; water, land,
 * borders and place labels stay.
 */

export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export interface MapTokens {
  water: string;
  land: string;
  label: string;
  coast: string;
  border: string;
  borderSoft: string;
  line: string;
  lineStrong: string;
  spot: string;
  signal: string;
  onSpot: string;
  bgSunken: string;
  inkMuted: string;
}

const FALLBACK_TOKENS: MapTokens = {
  water: "#c9cfd7",
  land: "#f3efe8",
  label: "#2b2825",
  coast: "#a39b90",
  border: "#5a534b",
  borderSoft: "#8a8279",
  line: "#2b2825",
  lineStrong: "#403b36",
  spot: "#f2a93b",
  signal: "#7cc9ea",
  onSpot: "#121110",
  bgSunken: "#0c0b0a",
  inkMuted: "#a69e92",
};

/** MapLibre paint properties need literal colors, so resolve the CSS custom properties once. */
export function readMapTokens(): MapTokens {
  if (typeof document === "undefined") return FALLBACK_TOKENS;
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    water: read("--map-water", FALLBACK_TOKENS.water),
    land: read("--map-land", FALLBACK_TOKENS.land),
    label: read("--map-label", FALLBACK_TOKENS.label),
    coast: read("--map-coast", FALLBACK_TOKENS.coast),
    border: read("--map-border", FALLBACK_TOKENS.border),
    borderSoft: read("--map-border-soft", FALLBACK_TOKENS.borderSoft),
    line: read("--line", FALLBACK_TOKENS.line),
    lineStrong: read("--line-strong", FALLBACK_TOKENS.lineStrong),
    spot: read("--spot", FALLBACK_TOKENS.spot),
    signal: read("--signal", FALLBACK_TOKENS.signal),
    onSpot: read("--on-spot", FALLBACK_TOKENS.onSpot),
    bgSunken: read("--bg-sunken", FALLBACK_TOKENS.bgSunken),
    inkMuted: read("--ink-muted", FALLBACK_TOKENS.inkMuted),
  };
}

interface StyleLayerJson {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StyleJson {
  layers: StyleLayerJson[];
  sources: Record<string, { type: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Place labels worth keeping, by layer id. Everything else symbol-shaped is hidden. */
const KEEP_LABELS = new Set(["label_city", "label_city_capital", "label_town", "label_state", "label_country_1", "label_country_2", "label_country_3"]);
/** Borders worth keeping: country and state/province. */
const KEEP_LINES = new Set(["boundary_2", "boundary_3"]);

export function recolorStyle(style: StyleJson, t: MapTokens): StyleJson {
  const next: StyleJson = JSON.parse(JSON.stringify(style));
  // Drop raster shading (Natural Earth relief) entirely.
  for (const [id, src] of Object.entries(next.sources)) if (src.type === "raster") delete next.sources[id];

  next.layers = next.layers
    .filter((l) => l.type !== "raster" && l.type !== "hillshade")
    .map((layer) => {
      const l = layer;
      l.paint = { ...(l.paint ?? {}) };
      l.layout = { ...(l.layout ?? {}) };
      const hide = () => {
        l.layout!.visibility = "none";
      };
      if (l.type === "background") {
        l.paint!["background-color"] = t.land;
      } else if (l.id === "water") {
        l.paint!["fill-color"] = t.water;
        // A one-pixel coastline so land reads against water at every zoom.
        l.paint!["fill-outline-color"] = t.coast;
      } else if (l.type === "line" && KEEP_LINES.has(l.id)) {
        const country = l.id === "boundary_2";
        l.paint!["line-color"] = country ? t.border : t.borderSoft;
        l.paint!["line-opacity"] = 1;
        l.paint!["line-width"] = country
          ? ["interpolate", ["linear"], ["zoom"], 2, 1, 6, 1.6, 10, 2.2]
          : ["interpolate", ["linear"], ["zoom"], 3, 0.7, 6, 1.1, 10, 1.6];
        delete l.paint!["line-dasharray"];
        // State and province lines only. The stock filter compares a possibly-missing number and logs warnings.
        if (l.id === "boundary_3") {
          l.filter = ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]];
        }
      } else if (l.type === "symbol" && KEEP_LABELS.has(l.id)) {
        delete l.layout!["icon-image"];
        delete l.layout!["icon-size"];
        l.layout!["icon-optional"] = true;
        if (l.id === "label_city" || l.id === "label_city_capital" || l.id === "label_town") {
          // Sit city names below the dot our own markers and glow occupy.
          l.layout!["text-anchor"] = "top";
          l.layout!["text-offset"] = [0, 1.5];
          l.layout!["text-size"] = ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 12, 11, 14];
        }
        l.paint!["text-color"] = t.label;
        l.paint!["text-halo-color"] = t.land;
        l.paint!["text-halo-width"] = 1;
        l.paint!["text-halo-blur"] = 0.5;
        if (l.id === "label_state") l.paint!["text-opacity"] = 0.8;
        if (l.id.startsWith("label_country")) l.paint!["text-opacity"] = 0.9;
      } else {
        hide();
      }
      return l;
    });
  return next;
}

let stylePromise: Promise<StyleJson> | null = null;

/** Fetch (once per page) and recolor the basemap style. Rejects if the style cannot be loaded. */
export function loadBasemapStyle(): Promise<StyleJson> {
  if (!stylePromise) {
    stylePromise = fetch(BASEMAP_STYLE_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Basemap style ${res.status}`);
        return res.json() as Promise<StyleJson>;
      })
      .then((json) => recolorStyle(json, readMapTokens()))
      .catch((err) => {
        stylePromise = null;
        throw err;
      });
  }
  return stylePromise;
}
