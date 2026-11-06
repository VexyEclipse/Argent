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
  /\b(?:(?:bd|dvd|web|hd)?\d{3,4}p|[xh]\s?26[45]|hevc|avc|av1|aac|flac|opus|e?ac3|ddp?\d?|dts|10\s?bit|8\s?bit|bd(?:rip)?|dvd(?:rip)?|blu\s?ray|web(?:\s?dl|rip)?|hdtv|dual\s?audio|multi\s?subs?|uncensored|v\d)\b/gi;

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

/** Whether a file is inside one of the library's folders; null when the folders aren't known. */
function inLibrary(e: BaseItem, roots: readonly string[] | null): boolean | null {
  const path = e.MediaSources?.[0]?.Path;
  if (!roots?.length || !path) return null;
  const p = path.replace(/\\/g, "/").toLowerCase();
  return roots.some((r) => p.startsWith(r.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() + "/"));
}

/** A copy with both a picture track and a sound track (a cut-off or broken file may lack one). */
function isWhole(e: BaseItem): boolean {
  const streams = e.MediaSources?.[0]?.MediaStreams ?? e.MediaStreams;
  if (!streams?.length) return true; // not reported: nothing to hold against it
  return streams.some((s) => s.Type === "Video") && streams.some((s) => s.Type === "Audio");
}

/**
 * How good a copy is to show and play, most important first: its file is in one of the
 * library's folders (a copy left behind by a removed folder has no file any more), it's
 * a real file, whole, with a picture.
 */
function score(e: BaseItem, roots: readonly string[] | null): number {
  let s = 0;
  if (inLibrary(e, roots) !== false) s += 64;
  if (e.LocationType !== "Virtual") s += 32;
  if (isWhole(e)) s += 16;
  if (e.ImageTags?.Primary) s += 8;
  if ((e.UserData?.PlaybackPositionTicks ?? 0) > 0) s += 2;
  if (e.Overview) s += 1;
  return s;
}

const keyOf = (e: BaseItem) =>
  e.IndexNumber === undefined ? null : `${e.ParentIndexNumber ?? ""}:${e.IndexNumber}:${e.IndexNumberEnd ?? ""}`;

/**
 * One episode per season and number, in the original order. A placeholder for a missing
 * episode gives way to a real file, and a copy left behind by a removed library folder
 * to one that's still there (when `roots`, the library's folders, are known). The copy
 * kept lists the others in `Copies`, is watched if any copy is, resumes from wherever one
 * was left part-way, and borrows a picture (only from a copy whose file is still there),
 * a proper title and the story from another copy when it has none of its own. A borrowed
 * title is marked `BorrowedName`, so it can be saved to the copy kept.
 */
export function mergeDuplicateEpisodes(episodes: BaseItem[], roots: readonly string[] | null = null): BaseItem[] {
  const groups = new Map<string, BaseItem[]>();
  for (const e of episodes) {
    const key = keyOf(e);
    if (key) groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: BaseItem[] = [];
  const done = new Set<string>();
  for (const e of episodes) {
    const key = keyOf(e);
    const group = key ? groups.get(key)! : [e];
    if (group.length === 1) {
      out.push(e);
      continue;
    }
    if (done.has(key!)) continue;
    done.add(key!);
    const best = group.reduce((a, b) => (score(b, roots) > score(a, roots) ? b : a));
    const others = group.filter((x) => x !== best && x.LocationType !== "Virtual");
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
      Copies: others.length ? others.map((x) => ({ Id: x.Id, Path: x.MediaSources?.[0]?.Path })) : undefined,
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
