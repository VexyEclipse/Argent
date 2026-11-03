// Pure MediaBar behaviour, kept free of React and the network so it can be unit tested.
import type { BaseItem, ExternalUrl } from "@/api/types";

// ---- list.txt -------------------------------------------------------------------

export const LIST_FILTER_PARAMS = {
  genre: "genres",
  tag: "tags",
  studio: "studios",
  year: "years",
  person: "person",
  rating: "officialRatings",
} as const;

export type ListFilterKey = keyof typeof LIST_FILTER_PARAMS;

export interface ListFilter {
  key: ListFilterKey;
  param: (typeof LIST_FILTER_PARAMS)[ListFilterKey];
  value: string;
}

export interface ParsedList {
  title?: string;
  ids: string[];
  filters: ListFilter[];
  ignored: string[];
}

export function parseListFilter(line: string): ListFilter | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const key = line.slice(0, colon).trim().toLowerCase() as ListFilterKey;
  const param = LIST_FILTER_PARAMS[key];
  if (!param) return null;
  // Commas mean "or"; Jellyfin takes pipe-separated alternatives.
  const value = line
    .slice(colon + 1)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("|");
  if (!value) return null;
  return { key, param, value };
}

/**
 * Parse the curated list: one item id or filter per line, `#` lines are comments
 * (the first one doubles as the list's title). Rejects HTML fallbacks from proxies.
 */
export function parseList(text: string): ParsedList {
  const out: ParsedList = { ids: [], filters: [], ignored: [] };
  if (!text || /^\s*</.test(text)) return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (out.title === undefined) out.title = line.replace(/^#+\s*/, "") || undefined;
      continue;
    }
    if (/^[0-9a-f-]{32,36}$/i.test(line)) {
      out.ids.push(line.replace(/-/g, "").toLowerCase());
      continue;
    }
    const filter = parseListFilter(line);
    if (filter) out.filters.push(filter);
    else out.ignored.push(line);
  }
  return out;
}

// ---- ordering ---------------------------------------------------------------------

export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Ensure the first `windowSize` slides include every item type present, swapping in
 * from later positions only where the head has a duplicate type to spare.
 */
export function mixTypesInHead<T extends { Type: string }>(items: T[], windowSize: number, random = Math.random): T[] {
  if (!windowSize || items.length <= windowSize) return items;
  const result = [...items];
  const types = new Set(result.map((i) => i.Type));
  if (types.size < 2) return result;
  for (const type of types) {
    const head = result.slice(0, windowSize);
    if (head.some((i) => i.Type === type)) continue;
    const from = result.findIndex((i, idx) => idx >= windowSize && i.Type === type);
    if (from === -1) continue;
    const counts: Record<string, number> = {};
    head.forEach((i) => (counts[i.Type] = (counts[i.Type] || 0) + 1));
    const spare = head.map((i, idx) => (counts[i.Type] > 1 ? idx : -1)).filter((idx) => idx !== -1);
    if (!spare.length) break;
    const to = spare[Math.floor(random() * spare.length)];
    [result[from], result[to]] = [result[to], result[from]];
  }
  return result;
}

/** Round-robin merge so every configured library is represented early. */
export function interleave<T>(pages: T[][], limit: number): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...pages.map((p) => p.length));
  for (let i = 0; i < longest; i++) for (const page of pages) if (i < page.length) merged.push(page[i]);
  return merged.slice(0, limit);
}

export function dedupe<T extends { Id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.Id) ? false : (seen.add(i.Id), true)));
}

/** Apply a remembered session order; new items are appended. */
export function applyStoredOrder<T extends { Id: string }>(items: T[], storedIds: string[]): T[] {
  const byId = new Map(items.map((i) => [i.Id, i]));
  const ordered = storedIds.map((id) => byId.get(id)).filter((i): i is T => Boolean(i));
  const known = new Set(ordered.map((i) => i.Id));
  return ordered.concat(items.filter((i) => !known.has(i.Id)));
}

/** Which of `numDots` dots is lit when there are more slides than dots. */
export function activeDot(index: number, total: number, numDots: number): number {
  if (total <= numDots) return index;
  return Math.min(numDots - 1, Math.floor((index / total) * numDots));
}

// ---- trailers ---------------------------------------------------------------------

export function youTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.split("/")[1] || null;
    if ((host === "youtube.com" || host === "m.youtube.com") && u.pathname.startsWith("/embed/")) {
      return u.pathname.split("/")[2] || null;
    }
    if (host.endsWith("youtube.com")) return u.searchParams.get("v");
  } catch {
    /* not a URL */
  }
  return null;
}

/**
 * Pick the best YouTube trailer: "official trailer" > "final/main trailer" > trailer >
 * teaser > anything; alternate cuts (sign language, vertical…) are demoted by half a rank.
 */
export function selectTrailerVideoId(trailers: ExternalUrl[] | undefined, alternateCutTerms: string[]): string | null {
  if (!trailers?.length) return null;
  let best: { id: string; rank: number } | null = null;
  for (const t of trailers) {
    const id = youTubeId(t.Url);
    if (!id) continue;
    const name = (t.Name || "").toLowerCase();
    let rank = name.includes("official trailer")
      ? 5
      : name.includes("final trailer") || name.includes("main trailer")
        ? 4
        : name.includes("trailer")
          ? 3
          : name.includes("teaser")
            ? 2
            : 1;
    if (alternateCutTerms.some((term) => name.includes(term))) rank -= 0.5;
    if (!best || rank > best.rank) best = { id, rank };
  }
  return best?.id ?? null;
}

// ---- plate colours ---------------------------------------------------------------

const B83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

/** Average colour of a BlurHash (its DC component), as sRGB 0–255. */
export function blurHashAverage(hash: string | undefined): [number, number, number] | null {
  if (!hash || hash.length < 6) return null;
  let v = 0;
  for (const ch of hash.slice(2, 6)) {
    const d = B83.indexOf(ch);
    if (d < 0) return null;
    v = v * 83 + d;
  }
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * Tinted panel and accent for the plate layout, derived from the backdrop's BlurHash.
 * Saturation is held low so the tint reads as a shade of charcoal, not a colour.
 */
export function plateColours(hash: string | undefined, plateLuminance: number, accentLuminance: number): { plate: string; accent: string } | null {
  const avg = blurHashAverage(hash);
  if (!avg) return null;
  const [h, s] = rgbToHsl(...avg);
  const sat = Math.min(s, 0.35) * 100;
  return {
    plate: `hsl(${h.toFixed(0)} ${sat.toFixed(0)}% ${(plateLuminance * 100).toFixed(1)}%)`,
    accent: `hsl(${h.toFixed(0)} ${(sat * 0.6).toFixed(0)}% ${(accentLuminance * 100 + 25).toFixed(0)}%)`,
  };
}

export function truncatePlot(text: string | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trimEnd()}…`;
}

export function hasLogo(item: BaseItem): boolean {
  return Boolean(item.ImageTags?.Logo);
}
