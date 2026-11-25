// Duplicate episodes: when the same episode is in the library more than once (a folder
// scanned twice, a second release, or items left behind by a folder that was removed),
// Jellyfin lists each as its own episode. Argent shows one per season and number: the
// most complete copy, carrying the watch state of them all, with any picture, title or
// story it lacks taken from the others.

import type { BaseItem } from "./types";

const letters = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "");

/** Release and format tags that file names carry: they're never part of a title. */
const TAGS =
  /\b(?:(?:bd|dvd|web|hd)?\d{3,4}p|[xh]\s?26[45]|hevc|avc|av1|aac\d?|flac\d?|opus|e?ac3|ddp?\d?|dts|(?:10|8)\s?b(?:its?)?|hi10p?|bd(?:rip)?|dvd(?:rip)?|blu\s?ray|web(?:\s?dl|rip)?|hdtv|dual\s?audio|multi\s?subs?|uncensored|v\d)\b/gi;

/** What's left of a bit of a title once numbers and release tags are taken out. */
const wordsOf = (s: string) => letters(s.replace(TAGS, " ").replace(/\d+/g, " "));

/**
 * Whether an episode's title is really just its file name, with nothing of a title left
 * once the show's name, episode numbers, years and release tags are taken out:
 * "Death Note - 01", "Attack on Titan - 01 (2013)", "[Group] Show - 03 (1080p)",
 * "S01E17-EMBER", "Episode 3". "Pokémon S03E39 - Forest Grumps" and "Episode 15 (The
 * Decisive Battle)" have titles.
 */
export function looksUnnamed(e: Pick<BaseItem, "Name" | "SeriesName">): boolean {
  let s = (e.Name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // File names use underscores and dots for spaces.
  s = s.replace(/[_.]+/g, " ");
  // Square brackets hold release groups and checksums; round ones hold tags, or sometimes the title.
  s = s.replace(/\[[^\]]*\]?|\{[^}]*\}?/g, " ").replace(/\(([^)]*)\)?/g, (_, inner: string) => (wordsOf(inner) ? ` ${inner} ` : " "));
  // A release group stuck to the end, in capitals: "S01E17-EMBER" (but "S01E12-Overload" is a title).
  s = s.replace(/(\S)-[A-Z0-9]{3,}\s*$/, "$1");
  s = s.replace(/\bS\d{1,2}\s*E\s?\d{1,4}\b|\bS\d{1,2}\b|\b\d{1,2}x\d{1,4}\b|\b(?:episode|ep|e)\s*\d+\b/gi, " ");
  let rest = wordsOf(s);
  // The show's name, whole or the part before a subtitle ("Demon Slayer" of "Demon Slayer: Kimetsu no Yaiba").
  const series = e.SeriesName ?? "";
  for (const name of [series, series.split(/\s*[:–—]\s*|\s+-\s+/)[0]]) {
    const l = letters(name);
    if (l) rest = rest.replace(l, "");
  }
  return rest.length === 0;
}

/** Whether a path is inside one of the library's folders; null when either isn't known. */
export function inLibraryPath(path: string | undefined, roots: readonly string[] | null): boolean | null {
  if (!roots?.length || !path) return null;
  const p = path.replace(/\\/g, "/").toLowerCase();
  return roots.some((r) => p.startsWith(r.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() + "/"));
}

const pathOf = (e: Pick<BaseItem, "MediaSources" | "Path">) => e.MediaSources?.[0]?.Path ?? e.Path;
const inLibrary = (e: Pick<BaseItem, "MediaSources" | "Path">, roots: readonly string[] | null) => inLibraryPath(pathOf(e), roots);

/** A copy with both a picture track and a sound track (a cut-off or broken file may lack one). */
function isWhole(e: BaseItem): boolean {
  const streams = e.MediaSources?.[0]?.MediaStreams ?? e.MediaStreams;
  if (!streams?.length) return true; // not reported: nothing to hold against it
  return streams.some((s) => s.Type === "Video") && streams.some((s) => s.Type === "Audio");
}

/**
 * How good a copy is to show and play, most important first: its file is in one of the
 * library's folders (a copy left behind by a removed folder has no file any more), it's
 * a real file, whole, of the edition shown (see "editions" below), with a picture.
 */
function score(e: BaseItem, roots: readonly string[] | null, edition: string | null = null): number {
  let s = 0;
  if (inLibrary(e, roots) !== false) s += 128;
  if (e.LocationType !== "Virtual") s += 64;
  if (isWhole(e)) s += 32;
  if (edition && folderOf(pathOf(e)) === edition) s += 16;
  if (e.ImageTags?.Primary) s += 8;
  if ((e.UserData?.PlaybackPositionTicks ?? 0) > 0) s += 2;
  if (e.Overview) s += 1;
  return s;
}

/**
 * Season and episode from a file name ("Show - S02E01 (036).mkv", "Show - 2x01"), for an
 * episode Jellyfin never numbered.
 */
export function numberFromPath(path: string | undefined): { season: number; episode: number } | null {
  const file = path?.split(/[\\/]/).pop() ?? "";
  const m = /S(\d{1,2})\s*E(\d{1,4})/i.exec(file) ?? /\b(\d{1,2})x(\d{2,4})\b/.exec(file);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

/** An episode with its number filled in from its file name, when Jellyfin has none. */
function withNumber(e: BaseItem): BaseItem {
  if (e.IndexNumber !== undefined) return e;
  const n = numberFromPath(e.MediaSources?.[0]?.Path ?? e.Path);
  return n ? { ...e, IndexNumber: n.episode, ParentIndexNumber: e.ParentIndexNumber ?? n.season } : e;
}

const COUNT_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ORDINAL_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const PART = "(?:season|series|part|cour|staffel|saison|temporada)";

/**
 * The season a folder's name says it holds, whatever Jellyfin made of it: "Season 2",
 * "Part 2", "Part II", "Season Two", "2nd Season", "Second Season", "S2". Null when the
 * name says none ("Original", "Specials").
 */
export function folderSeason(name: string): number | null {
  const n = name.toLowerCase().replace(/[._]+/g, " ").trim();
  const counted = new RegExp(`\\b${PART}\\s*-?\\s*(\\d{1,2}|${ROMAN.join("|")}|${COUNT_WORDS.join("|")})\\b`).exec(n);
  if (counted) {
    const w = counted[1];
    return /^\d+$/.test(w) ? Number(w) : COUNT_WORDS.indexOf(w) + 1 || ROMAN.indexOf(w) + 1;
  }
  const ordinal = new RegExp(`\\b(?:(\\d{1,2})(?:st|nd|rd|th)|(${ORDINAL_WORDS.join("|")}))\\s+${PART}\\b`).exec(n);
  if (ordinal) return ordinal[1] ? Number(ordinal[1]) : ORDINAL_WORDS.indexOf(ordinal[2]) + 1;
  const short = /^s(\d{1,2})$/.exec(n);
  return short ? Number(short[1]) : null;
}

/**
 * An episode in a folder whose name says another season than Jellyfin gave it ("Part 2"
 * isn't a season folder to Jellyfin, so its episodes count as season 1), moved to that
 * season, unless its file name says the season itself. Without this, a second season
 * numbered 01, 02… would pass for a copy of the first.
 */
function withFolderSeason(e: BaseItem): BaseItem {
  const path = pathOf(e);
  if (!path || numberFromPath(path) || e.ParentIndexNumber === 0) return e;
  const n = folderSeason(path.split(/[\\/]/).slice(-2, -1)[0] ?? "");
  return n !== null && n !== e.ParentIndexNumber ? { ...e, ParentIndexNumber: n, SeasonFromFolder: true } : e;
}

/** Episodes moved to another season by their folder go after that season's others (Jellyfin sorted them as season 1). */
function placeBySeason(episodes: BaseItem[]): BaseItem[] {
  if (!episodes.some((e) => e.SeasonFromFolder)) return episodes;
  const out = episodes.filter((e) => !e.SeasonFromFolder);
  for (const e of episodes.filter((x) => x.SeasonFromFolder)) {
    const n = e.ParentIndexNumber!;
    let at = -1;
    out.forEach((x, i) => {
      if ((x.ParentIndexNumber ?? 0) > 0 && x.ParentIndexNumber! <= n) at = i;
    });
    if (at < 0) {
      const later = out.findIndex((x) => (x.ParentIndexNumber ?? 0) > n);
      at = (later < 0 ? out.length : later) - 1;
    }
    out.splice(at + 1, 0, e);
  }
  return out;
}

function keyOf(e: BaseItem): string | null {
  if (e.IndexNumber !== undefined) return `${e.ParentIndexNumber ?? ""}:${e.IndexNumber}:${e.IndexNumberEnd ?? ""}`;
  const n = numberFromPath(e.MediaSources?.[0]?.Path ?? e.Path);
  return n ? `${n.season}:${n.episode}:` : null;
}

/**
 * One episode per season and number, in the original order. A placeholder for a missing
 * episode gives way to a real file, and a copy left behind by a removed library folder
 * to one that's still there (when `roots`, the library's folders, are known); an episode
 * whose only copies are outside them has no file at all and is left out. An episode
 * Jellyfin never numbered is matched by the number in its file name. The copy kept lists
 * the others in `Copies`, is watched if any copy is, resumes from wherever one was left
 * part-way, and borrows a picture (only from a copy whose file is still there), a proper
 * title and the story from another copy when it has none of its own. A borrowed title is
 * marked `BorrowedName`, so it can be saved to the copy kept. An episode whose folder
 * names its season ("Part 2") is numbered and placed as that season's (`SeasonFromFolder`).
 */
export function mergeDuplicateEpisodes(listed: BaseItem[], roots: readonly string[] | null = null, chosen: string | null = null): BaseItem[] {
  const episodes = placeBySeason(listed.map(withFolderSeason));
  const groups = new Map<string, BaseItem[]>();
  for (const e of episodes) {
    const key = keyOf(e);
    if (key) groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const edition = pickEdition([...groups.values()], roots, chosen);
  const pick = (group: BaseItem[]) => group.reduce((a, b) => (score(b, roots, edition) > score(a, roots, edition) ? b : a));
  const out: BaseItem[] = [];
  for (const e of episodes) {
    const key = keyOf(e);
    const group = key ? groups.get(key)! : [e];
    // Nothing of it in the library's folders: a leftover with no file to show or play.
    if (group.every((x) => inLibrary(x, roots) === false)) continue;
    if (group.length === 1) {
      out.push(withNumber(e));
      continue;
    }
    // The row goes where the copy shown is (an unnumbered leftover sorts first in Jellyfin's list).
    if (pick(group) !== e) continue;
    const best = withNumber(e);
    const others = group.filter((x) => x.Id !== best.Id && x.LocationType !== "Virtual");
    const resume = [best, ...others].find((x) => (x.UserData?.PlaybackPositionTicks ?? 0) > 0);
    const pictured = best.ImageTags?.Primary ? null : group.find((x) => x.ImageTags?.Primary && inLibrary(x, roots) !== false);
    const named = looksUnnamed(best) ? group.find((x) => !looksUnnamed(x)) : null;
    out.push({
      ...best,
      ...(named && { Name: named.Name, Overview: best.Overview || named.Overview, BorrowedName: true }),
      ...(!best.Overview && !named && { Overview: group.find((x) => x.Overview)?.Overview }),
      ...(pictured && {
        ImageTags: { ...best.ImageTags, Primary: pictured.ImageTags!.Primary },
        ImageBlurHashes: { ...best.ImageBlurHashes, Primary: pictured.ImageBlurHashes?.Primary },
        PrimaryImageItemId: pictured.Id,
      }),
      UserData: {
        ...best.UserData,
        Played: group.some((x) => x.UserData?.Played),
        PlaybackPositionTicks: resume?.UserData?.PlaybackPositionTicks ?? best.UserData?.PlaybackPositionTicks,
        PlayedPercentage: resume?.UserData?.PlayedPercentage ?? best.UserData?.PlayedPercentage,
      },
      Copies: others.length
        ? others.map((x) => ({ Id: x.Id, Path: x.MediaSources?.[0]?.Path, SeasonId: x.SeasonId, MediaSources: x.MediaSources }))
        : undefined,
    });
  }
  return out;
}

/** Every library item behind an episode row: the one shown and its hidden copies. */
export const copyIds = (e: Pick<BaseItem, "Id" | "Copies">) => [e.Id, ...(e.Copies?.map((c) => c.Id) ?? [])];

// ---- shows with copies -----------------------------------------------------------------
// Jellyfin's counts (the unwatched number on a show's poster) include every copy. Shows
// seen to have copies are remembered, so their counts can come from the merged list
// instead; one seen without any (after a library scan cleared them) is forgotten.

const WITH_COPIES_KEY = "argent.showsWithCopies";
let withCopies: Set<string> | null = null;
const listeners = new Set<() => void>();

function shows(): Set<string> {
  if (withCopies) return withCopies;
  try {
    withCopies = new Set(JSON.parse(localStorage.getItem(WITH_COPIES_KEY) || "[]"));
  } catch {
    withCopies = new Set();
  }
  return withCopies;
}

/** Notes whether a show's episodes (all of them, or one season's) included copies. */
export function noteCopies(seriesId: string, merged: BaseItem[], wholeShow: boolean) {
  const has = merged.some((e) => e.Copies?.length);
  const set = shows();
  // A single season without copies says nothing about the others.
  if (has === set.has(seriesId) || (!has && !wholeShow)) return;
  withCopies = new Set(set);
  if (has) withCopies.add(seriesId);
  else withCopies.delete(seriesId);
  try {
    localStorage.setItem(WITH_COPIES_KEY, JSON.stringify([...withCopies]));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export const hasCopies = (seriesId: string) => shows().has(seriesId);

export function subscribeCopies(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Unwatched episodes, counting each episode once however many copies it has. */
export const unwatchedCount = (merged: BaseItem[]) => merged.filter((e) => e.LocationType !== "Virtual" && !e.UserData?.Played).length;

// ---- editions ---------------------------------------------------------------------------
// A show kept in two releases side by side (a Blu-ray in "Season 1" and the first release
// in "Original") has each episode twice. Each folder holding such copies is an edition:
// the one chosen for the show (remembered on this device) is the copy shown and played,
// else the sharpest. A season folder holding nothing but another edition's copies isn't a
// season of its own, so the show page leaves it out.

/** The folder a file is in, as compared and remembered ("d:/shows/x/season 1"); null when unknown. */
export function folderOf(path: string | undefined): string | null {
  const p = path?.replace(/\\/g, "/");
  const i = p?.lastIndexOf("/") ?? -1;
  return p && i > 0 ? p.slice(0, i).toLowerCase() : null;
}

/** A copy's picture height, reading a wide film by its width (1920×800 counts as 1080). */
function linesOf(e: Pick<BaseItem, "MediaSources" | "MediaStreams">): number {
  const v = (e.MediaSources?.[0]?.MediaStreams ?? e.MediaStreams)?.find((s) => s.Type === "Video");
  return Math.max(v?.Height ?? 0, Math.round(((v?.Width ?? 0) * 9) / 16));
}

/**
 * The edition to show: the one chosen, if this list has it; else the folder whose copies
 * are sharpest, when one is. Null when there's nothing to choose between.
 */
function pickEdition(groups: BaseItem[][], roots: readonly string[] | null, chosen: string | null): string | null {
  const best = new Map<string, number>();
  for (const group of groups) {
    const real = group.filter((x) => x.LocationType !== "Virtual" && inLibrary(x, roots) !== false);
    if (real.length < 2) continue;
    for (const x of real) {
      const folder = folderOf(pathOf(x));
      if (folder) best.set(folder, Math.max(best.get(folder) ?? 0, linesOf(x)));
    }
  }
  if (best.size < 2) return null;
  if (chosen && best.has(chosen)) return chosen;
  const ranked = [...best].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > ranked[ranked.length - 1][1] ? ranked[0][0] : null;
}

const SEASON_FOLDER = /^(?:season|series|staffel|saison|temporada|s)[\s._-]*\d+$|^specials?$/i;

/** The release group in a file name's leading brackets ("[Group]Show_-_01" → "Group"). */
export function releaseGroup(path: string | undefined): string | undefined {
  const file = path?.split(/[\\/]/).pop() ?? "";
  return /^\[([^\]]+)\]/.exec(file)?.[1].trim() || undefined;
}

/**
 * What to call an edition: its folder's name ("Original"), or for a plain season folder
 * what its file names say it is ("Blu-ray", "DVD", "Web") or who released it.
 */
export function editionName(path: string | undefined): string {
  const parts = (path ?? "").split(/[\\/]/);
  const file = parts.pop() ?? "";
  const folder = parts.pop() ?? "";
  if (folder && !SEASON_FOLDER.test(folder)) return folder;
  if (/(?:^|[^a-z])(?:bd(?:rip|remux)?|blu-?ray)(?![a-z])/i.test(file)) return "Blu-ray";
  if (/(?:^|[^a-z])dvd(?:rip)?(?![a-z])/i.test(file)) return "DVD";
  if (/(?:^|[^a-z])web(?:-?dl|-?rip)?(?![a-z])/i.test(file)) return "Web";
  return releaseGroup(path) ?? (folder || "Copy");
}

export interface Edition {
  /** As compared and remembered (see folderOf). */
  folder: string;
  name: string;
  group?: string;
  /** One of its files, for its resolution and format. */
  source?: NonNullable<BaseItem["MediaSources"]>[number];
  /** How many episodes it has a copy of. */
  episodes: number;
  /** How many of the copies shown are its own. */
  shown: number;
}

/** The editions in a merged episode list (from mergeDuplicateEpisodes), largest first; none when there's only one. */
export function editionsOf(merged: BaseItem[], roots: readonly string[] | null = null): Edition[] {
  const found = new Map<string, Edition>();
  const add = (x: Pick<BaseItem, "MediaSources" | "Path" | "LocationType">, shown: boolean) => {
    const path = pathOf(x);
    const folder = folderOf(path);
    if (!folder || x.LocationType === "Virtual" || inLibraryPath(path, roots) === false) return;
    const e = found.get(folder) ?? { folder, name: editionName(path), group: releaseGroup(path), source: x.MediaSources?.[0], episodes: 0, shown: 0 };
    e.episodes++;
    if (shown) e.shown++;
    found.set(folder, e);
  };
  for (const row of merged) {
    if (!row.Copies?.length) continue;
    add(row, true);
    for (const c of row.Copies) add(c, false);
  }
  const list = [...found.values()].sort((a, b) => b.episodes - a.episodes);
  return list.length > 1 ? list : [];
}

/**
 * Seasons holding nothing but copies of episodes that are also elsewhere: an edition's
 * own folder ("Original") that Jellyfin took for a season. The show page leaves out the
 * ones without a number (a numbered season is always a season).
 */
export function copyOnlySeasons(merged: BaseItem[]): Set<string> {
  const copied = new Set<string>();
  const own = new Set<string>();
  for (const row of merged) {
    if (row.Copies?.length) {
      if (row.SeasonId) copied.add(row.SeasonId);
      for (const c of row.Copies) if (c.SeasonId) copied.add(c.SeasonId);
    } else if (row.SeasonId) own.add(row.SeasonId);
  }
  return new Set([...copied].filter((id) => !own.has(id)));
}

const NO_ID = /^[0-]*$/;

/**
 * The seasons a merged episode list's episodes and their copies are in, to tell an empty
 * season (a "Season Unknown" left behind by a scan) from one with episodes. Null when an
 * episode's season isn't known: Jellyfin then files it under a season by name alone.
 */
export function episodeSeasons(merged: BaseItem[]): Set<string> | null {
  const ids = new Set<string>();
  for (const x of merged.flatMap((row) => [row, ...(row.Copies ?? [])])) {
    if (!x.SeasonId || NO_ID.test(x.SeasonId)) return null;
    ids.add(x.SeasonId);
  }
  return ids;
}

const EDITIONS_KEY = "argent.editions";

function readEditions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(EDITIONS_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

/** The edition (folder) chosen for a show on this device, if one was. */
export const chosenEdition = (seriesId: string): string | null => readEditions()[seriesId] ?? null;

/** Remembers the edition to show and play for a show (null: the sharpest again). */
export function chooseEdition(seriesId: string, folder: string | null) {
  const all = readEditions();
  if (folder) all[seriesId] = folder;
  else delete all[seriesId];
  try {
    localStorage.setItem(EDITIONS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
