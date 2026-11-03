// MediaBar configuration. Mirrors the option set of the Jellyfin Media Bar plugin
// (MakD/Jellyfin-Media-Bar v6 + IAmParadox27/jellyfin-plugin-media-bar), re-implemented
// for Argent. Precedence, lowest to highest, matches the plugin:
//   built-in defaults → plugin server config (/MediaBar/WebConfig, -1 = unset)
//   → deployment defaults (argent.config.json "mediaBar", like window.SlideshowConfig)
//   → the viewer's own saved settings (unless the key is locked).

export type MediaBarLayout = "marquee" | "plate" | "classic";

export interface MediaBarConfig {
  shuffleInterval: number;
  minSwipeDistance: number;
  maxPlotLength: number;
  maxItems: number;
  maxMovies: number;
  maxSeries: number;
  libraries: string[];
  trailerLibraries: string[];
  preloadCount: number;
  maxDots: number;
  mixTypesInFirst: number;
  fadeTransitionDuration: number;
  slideAnimationEnabled: boolean;
  enableTrailers: boolean;
  allowTrailersOnTouch: boolean;
  trailerAlternateCutTerms: string[];
  syncPageBackdrop: boolean;
  youtubeApiLoadTimeoutMs: number;
  trailerStartDelayMs: number;
  trailerPlaybackWatchdogMs: number;
  trailerVolume: number;
  trailerCaptions: boolean;
  touchLayoutMaxWidth: number;
  useBlurHashPlaceholder: boolean;
  layout: MediaBarLayout;
  plateLuminance: number;
  plateAccentLuminance: number;
  plateFallback: string;
  plateAccentFallback: string;
  plateSpecRows: number;
  preferLocalTrailers: boolean;
  pauseOnHover: boolean;
  rememberOrderForSession: boolean;
  respectDataSaver: boolean;
  enableSponsorBlock: boolean;
  imageSvgs: { freshTomato?: string; rottenTomato?: string };
}

export const MEDIABAR_DEFAULTS: MediaBarConfig = {
  shuffleInterval: 12000,
  minSwipeDistance: 50,
  maxPlotLength: 360,
  maxItems: 50,
  maxMovies: 0,
  maxSeries: 0,
  libraries: [],
  trailerLibraries: [],
  preloadCount: 1,
  maxDots: 5,
  mixTypesInFirst: 3,
  fadeTransitionDuration: 500,
  slideAnimationEnabled: true,
  enableTrailers: true,
  allowTrailersOnTouch: false,
  trailerAlternateCutTerms: ["sign language", "asl trailer", "audio description", "audio described", "described audio", "vertical"],
  syncPageBackdrop: false,
  youtubeApiLoadTimeoutMs: 8000,
  trailerStartDelayMs: 3500,
  trailerPlaybackWatchdogMs: 4000,
  trailerVolume: 50,
  trailerCaptions: false,
  touchLayoutMaxWidth: 767,
  useBlurHashPlaceholder: true,
  layout: "marquee",
  plateLuminance: 0.035,
  plateAccentLuminance: 0.42,
  plateFallback: "rgb(28 30 34)",
  plateAccentFallback: "rgb(150 156 166)",
  plateSpecRows: 4,
  preferLocalTrailers: true,
  pauseOnHover: true,
  rememberOrderForSession: true,
  respectDataSaver: true,
  enableSponsorBlock: false,
  imageSvgs: {},
};

type Rule = [number, number] | readonly string[] | "colour" | "boolean" | "strings";

/** Same validation ranges as the plugin's CONFIG_RULES. */
export const MEDIABAR_RULES: Partial<Record<keyof MediaBarConfig, Rule>> = {
  shuffleInterval: [2000, 600000],
  minSwipeDistance: [10, 400],
  maxPlotLength: [40, 4000],
  maxItems: [1, 500],
  maxMovies: [0, 500],
  maxSeries: [0, 500],
  preloadCount: [0, 10],
  maxDots: [1, 40],
  mixTypesInFirst: [0, 20],
  fadeTransitionDuration: [0, 5000],
  youtubeApiLoadTimeoutMs: [1000, 60000],
  trailerStartDelayMs: [0, 60000],
  trailerPlaybackWatchdogMs: [500, 60000],
  trailerVolume: [0, 100],
  touchLayoutMaxWidth: [320, 2000],
  plateLuminance: [0, 1],
  plateAccentLuminance: [0, 1],
  plateSpecRows: [1, 8],
  layout: ["classic", "marquee", "plate"],
  plateFallback: "colour",
  plateAccentFallback: "colour",
  libraries: "strings",
  trailerLibraries: "strings",
  trailerAlternateCutTerms: "strings",
  slideAnimationEnabled: "boolean",
  enableTrailers: "boolean",
  allowTrailersOnTouch: "boolean",
  syncPageBackdrop: "boolean",
  trailerCaptions: "boolean",
  useBlurHashPlaceholder: "boolean",
  preferLocalTrailers: "boolean",
  pauseOnHover: "boolean",
  rememberOrderForSession: "boolean",
  respectDataSaver: "boolean",
  enableSponsorBlock: "boolean",
};

/** Returns a cleaned value, or null when the value is invalid for the key. */
export function validateValue(key: keyof MediaBarConfig, value: unknown): unknown {
  const rule = MEDIABAR_RULES[key];
  if (key === "imageSvgs") return value && typeof value === "object" ? value : null;
  if (!rule) return typeof value === typeof MEDIABAR_DEFAULTS[key] ? value : null;
  if (rule === "boolean") return typeof value === "boolean" ? value : null;
  if (rule === "strings") {
    if (!Array.isArray(value)) return null;
    return value.filter((v) => typeof v === "string" && v.trim()).map((v) => String(v).trim());
  }
  if (rule === "colour") {
    if (typeof value !== "string") return null;
    return typeof CSS !== "undefined" && CSS.supports?.("color", value) ? value : null;
  }
  if (Array.isArray(rule) && typeof rule[0] === "number") {
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    const [min, max] = rule as [number, number];
    return Math.min(max, Math.max(min, n));
  }
  if (Array.isArray(rule)) return (rule as readonly unknown[]).includes(value) ? value : null;
  return null;
}

function applyPatch(target: MediaBarConfig, patch: Record<string, unknown> | null | undefined) {
  if (!patch) return;
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in MEDIABAR_DEFAULTS)) continue;
    const clean = validateValue(key as keyof MediaBarConfig, raw);
    if (clean !== null) (target as unknown as Record<string, unknown>)[key] = clean;
  }
}

/**
 * Translate the plugin's PascalCase WebConfig into config keys. Integers of -1 mean
 * "not set" in the plugin and are skipped, exactly as its injector does.
 */
export function fromPluginWebConfig(web: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!web) return {};
  const out: Record<string, unknown> = {};
  const num = (src: string, dst: keyof MediaBarConfig) => {
    const v = web[src];
    if (typeof v === "number" && v >= 0) out[dst] = v;
  };
  num("ShuffleInterval", "shuffleInterval");
  num("MinSwipeDistance", "minSwipeDistance");
  num("MaxPlotLength", "maxPlotLength");
  num("MaxMovies", "maxMovies");
  num("MaxTvShows", "maxSeries");
  num("MaxItems", "maxItems");
  num("PreloadCount", "preloadCount");
  num("FadeTransitionDuration", "fadeTransitionDuration");
  for (const [src, dst] of [
    ["SlideAnimationEnabled", "slideAnimationEnabled"],
    ["EnableTrailers", "enableTrailers"],
    ["SyncPageBackdrop", "syncPageBackdrop"],
  ] as const) {
    if (typeof web[src] === "boolean") out[dst] = web[src];
  }
  const svgs = web.ImageSvgs as Record<string, string | null> | undefined;
  if (svgs) {
    const imageSvgs: MediaBarConfig["imageSvgs"] = {};
    if (svgs.FreshTomato) imageSvgs.freshTomato = svgs.FreshTomato;
    if (svgs.RottenTomato) imageSvgs.rottenTomato = svgs.RottenTomato;
    if (Object.keys(imageSvgs).length) out.imageSvgs = imageSvgs;
  }
  return out;
}

export interface ResolvedMediaBarConfig {
  config: MediaBarConfig;
  /** Value the viewer would get with no personal overrides. */
  serverDefaults: MediaBarConfig;
  locked: Set<string>;
}

const storageKey = (userId: string) => `argent.mediabar.${userId}`;

export function readViewerConfig(userId: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveViewerConfig(userId: string, patch: Record<string, unknown>) {
  try {
    const next = { ...readViewerConfig(userId), ...patch };
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function clearViewerConfig(userId: string) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}

export function resolveConfig(
  pluginWebConfig: Record<string, unknown> | null,
  deployment: (Record<string, unknown> & { lock?: unknown }) | null,
  viewer: Record<string, unknown>,
): ResolvedMediaBarConfig {
  const base: MediaBarConfig = structuredClone(MEDIABAR_DEFAULTS);
  applyPatch(base, fromPluginWebConfig(pluginWebConfig));
  const { lock, ...deploymentValues } = deployment ?? {};
  applyPatch(base, deploymentValues);
  const locked = new Set(Array.isArray(lock) ? lock.filter((k): k is string => typeof k === "string") : []);

  const serverDefaults = structuredClone(base);
  const viewerAllowed = Object.fromEntries(Object.entries(viewer).filter(([k]) => !locked.has(k)));
  applyPatch(base, viewerAllowed);
  return { config: base, serverDefaults, locked };
}
