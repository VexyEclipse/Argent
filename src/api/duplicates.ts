// Duplicate episodes: when the same episode is in the library more than once (a folder
// scanned twice, a second release, or items left behind by a folder that was removed),
// Jellyfin lists each as its own episode. Argent shows one per season and number: the
// most complete copy, carrying the watch state of them all, with any picture, title or
// story it lacks taken from the others.

import type { BaseItem } from "./types";

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Whether an episode's title is really just its file name ("Death Note - 01",
 * "[Group] Show - 03 (1080p)", "Episode 3", "S01E03"): Jellyfin found no proper title.
 */
export function looksUnnamed(e: Pick<BaseItem, "Name" | "SeriesName" | "MediaSources">): boolean {
  const name = (e.Name ?? "").trim();
  if (!name) return true;
  const bare = normalise(name);
  const file = e.MediaSources?.[0]?.Path?.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{2,4}$/i, "");
  if (file && normalise(file) === bare) return true;
  if (/^(?:episode|ep\.?|e)?\s*0*\d{1,4}$/i.test(name) || /\bS\d{1,2}\s*E\d{1,4}\b/i.test(name)) return true;
  const series = e.SeriesName ? normalise(e.SeriesName) : "";
  return Boolean(series && bare.startsWith(series) && /^\d{0,4}$/.test(bare.slice(series.length)));
}

/** A copy with both a picture track and a sound track (a cut-off or broken file may lack one). */
function isWhole(e: BaseItem): boolean {
  const streams = e.MediaSources?.[0]?.MediaStreams ?? e.MediaStreams;
  if (!streams?.length) return true; // not reported: nothing to hold against it
  return streams.some((s) => s.Type === "Video") && streams.some((s) => s.Type === "Audio");
}

/** How good a copy is to show and play, most important first: a real file, whole, with a picture. */
function score(e: BaseItem): number {
  let s = 0;
  if (e.LocationType !== "Virtual") s += 32;
  if (isWhole(e)) s += 16;
  if (e.ImageTags?.Primary) s += 8;
  if (!looksUnnamed(e)) s += 4;
  if ((e.UserData?.PlaybackPositionTicks ?? 0) > 0) s += 2;
  if (e.Overview) s += 1;
  return s;
}

const keyOf = (e: BaseItem) =>
  e.IndexNumber === undefined ? null : `${e.ParentIndexNumber ?? ""}:${e.IndexNumber}:${e.IndexNumberEnd ?? ""}`;

/**
 * One episode per season and number, in the original order. A placeholder for a missing
 * episode gives way to a real file. The copy kept lists the others in `Copies`, is watched
 * if any copy is, resumes from wherever one was left part-way, and borrows a picture, a
 * proper title and the story from another copy when it has none of its own.
 */
export function mergeDuplicateEpisodes(episodes: BaseItem[]): BaseItem[] {
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
    const best = group.reduce((a, b) => (score(b) > score(a) ? b : a));
    const others = group.filter((x) => x !== best && x.LocationType !== "Virtual");
    const resume = [best, ...others].find((x) => (x.UserData?.PlaybackPositionTicks ?? 0) > 0);
    const pictured = best.ImageTags?.Primary ? null : group.find((x) => x.ImageTags?.Primary);
    const named = looksUnnamed(best) ? group.find((x) => !looksUnnamed(x)) : null;
    out.push({
      ...best,
      ...(named && { Name: named.Name, Overview: best.Overview || named.Overview }),
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
