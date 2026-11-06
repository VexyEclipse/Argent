// Episode stills: for administrators, each episode's picture is replaced with its still from
// the library's metadata providers (TheMovieDb and the like) instead of a frame grabbed from
// the video, which can land on an opening or a title card. Jellyfin downloads and saves the
// still itself, so every app shows it; with "save artwork into media folders" on, that
// replaces the episode's -thumb.jpg beside the video. Each episode is done once, as its
// season is opened; one the providers have no still for keeps its picture. A finished
// season is recorded in the account, so other devices skip it. After that a show is only
// looked at again for episodes added since, when it's re-identified (its provider ids
// change, so its stills may be different ones), or when "Fix episode titles and
// pictures" asks for it in Refresh metadata.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { downloadRemoteImage, getRemoteImages, type RemoteImage } from "@/api/manage";
import { createSyncedMap } from "@/api/syncedMap";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { logEvent } from "@/features/diagnostics/log";

const PREF_KEY = "argent.episodeStills";
const DONE_KEY = "argent.stillsDone";
const MAX_SHOWS = 400;
/** A pause between episodes, so a long season doesn't flood the server or the provider. */
const GAP_MS = 250;

// ---- setting (this device) -------------------------------------------------------------

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function readStillsPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setStillsPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, String(on));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export const useStillsPref = () => useSyncExternalStore(subscribe, readStillsPref);

// ---- which episodes are done -------------------------------------------------------------

/** Seasons finished on any device ("series:season" → when), shared through the account. */
const seasonsDone = createSyncedMap<number>({ prefsId: "argent-library", field: "stillsDone", storageKey: "argent.stillsSeasons", max: 3000 });
const seasonKey = (seriesId: string, e: Pick<BaseItem, "ParentIndexNumber">) => `${seriesId}:${e.ParentIndexNumber ?? 0}`;
/** Which provider entries a show's stills came from ("Tmdb=1399|Tvdb=121361"), shared through the account. */
const showMatches = createSyncedMap<string>({ prefsId: "argent-library", field: "stillsMatch", storageKey: "argent.stillsMatch", max: 3000 });

/** A show's provider ids as one string, to notice when it's re-identified. Empty when it has none. */
export const matchKey = (ids: Record<string, string> | undefined) =>
  Object.entries(ids ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort()
    .join("|");

/**
 * Whether an episode still needs its still: not done on this device, not in a season
 * another device finished before the episode arrived, or its show was re-identified since.
 */
export function needsStill(
  e: Pick<BaseItem, "Id" | "Type" | "LocationType" | "ParentIndexNumber" | "DateCreated">,
  seriesId: string,
  known: { doneHere: ReadonlySet<string>; seasons: Record<string, number>; rematched: boolean },
): boolean {
  if (e.Type !== "Episode" || e.LocationType === "Virtual") return false;
  if (known.rematched) return true;
  if (known.doneHere.has(e.Id)) return false;
  const at = known.seasons[seasonKey(seriesId, e)];
  return !(at !== undefined && (Date.parse(e.DateCreated ?? "") || 0) <= at);
}

/** Forgets what was done for a show (it was re-identified): its stills are fetched again. */
function forgetShow(userId: string, seriesId: string, seasons: Record<string, number>) {
  const all = readDone();
  delete all[seriesId];
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  for (const key of Object.keys(seasons)) if (key.startsWith(`${seriesId}:`)) seasonsDone.remove(userId, key);
}

type Done = Record<string, string[]>;

function readDone(): Done {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

function markDone(seriesId: string, ids: string[]) {
  if (!ids.length) return;
  const all = readDone();
  const list = [...new Set([...(all[seriesId] ?? []), ...ids])];
  delete all[seriesId];
  all[seriesId] = list;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SHOWS))) delete all[k];
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(all));
  } catch {
    /* storage full: those episodes are simply checked again */
  }
}

// ---- choosing a still ------------------------------------------------------------------------

/**
 * The still to use: TheMovieDb's first, then any other provider's; wide pictures before
 * tall ones; the best rated, then the largest. Null when there's nothing usable.
 */
export function pickStill(images: RemoteImage[]): RemoteImage | null {
  const usable = images.filter((i) => i.Url && !(i.Width && i.Height && i.Height > i.Width));
  if (!usable.length) return null;
  const rank = (i: RemoteImage) => [
    /themoviedb|tmdb/i.test(i.ProviderName ?? "") ? 1 : 0,
    i.CommunityRating ?? 0,
    i.VoteCount ?? 0,
    i.Width ?? 0,
  ];
  return [...usable].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let k = 0; k < ra.length; k++) if (ra[k] !== rb[k]) return rb[k] - ra[k];
    return 0;
  })[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running = new Set<string>();

/**
 * Replaces episodes' pictures with provider stills, one at a time, remembering each as
 * done. Stops at the first failure (server or provider unreachable), so the rest are tried
 * next time. `complete` says whether every episode was reached.
 */
export async function fetchStills(
  seriesId: string,
  episodes: BaseItem[],
  opts: { stopped?: () => boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ saved: number; complete: boolean }> {
  let saved = 0;
  for (const [i, e] of episodes.entries()) {
    if (opts.stopped?.()) return { saved, complete: false };
    try {
      const still = pickStill((await getRemoteImages(e.Id, "Primary")).Images);
      if (still?.Url) {
        await downloadRemoteImage(e.Id, "Primary", still.Url);
        saved++;
      }
      markDone(seriesId, [e.Id]);
    } catch (err) {
      // The server answered with an error for this episode (the provider doesn't know it):
      // it keeps its picture and isn't asked again. No answer at all: stop and try later.
      if (!(err instanceof ApiError)) return { saved, complete: false };
      markDone(seriesId, [e.Id]);
    }
    opts.onProgress?.(i + 1, episodes.length);
    await sleep(GAP_MS);
  }
  if (saved) logEvent("stills", `Saved ${saved} episode stills for series ${seriesId}`);
  return { saved, complete: true };
}

/**
 * Records seasons as finished in the account, so other devices skip them, and which
 * provider entries the show was matched to, to notice when it's re-identified.
 */
export function markSeasonsDone(userId: string, seriesId: string, episodes: BaseItem[], match?: string) {
  for (const key of new Set(episodes.map((e) => seasonKey(seriesId, e)))) seasonsDone.set(userId, key, Date.now());
  if (match) showMatches.set(userId, seriesId, match);
}

/**
 * Replaces the pictures of a season's episodes with provider stills, one episode at a time,
 * while the season is on screen (administrators, when the setting is on). Reports how many
 * are left, for a progress line.
 */
export function useEpisodeStills(seriesId: string, episodes: BaseItem[] | undefined, seriesIds?: Record<string, string>): { left: number; total: number } {
  const { isAdmin, user } = useAuth();
  const on = useStillsPref();
  const finished = seasonsDone.use();
  const matches = showMatches.use();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState({ left: 0, total: 0 });
  const match = seriesIds ? matchKey(seriesIds) : "";

  useEffect(() => {
    if (!isAdmin || !on || !episodes?.length || !user) return;
    // Re-identified since its stills were fetched: start the show over.
    if (match && matches[seriesId] && matches[seriesId] !== match) {
      forgetShow(user.Id, seriesId, finished);
      showMatches.set(user.Id, seriesId, match);
      return;
    }
    const known = { doneHere: new Set(readDone()[seriesId] ?? []), seasons: finished, rematched: false };
    const todo = episodes.filter((e) => needsStill(e, seriesId, known));
    const key = `${seriesId}:${todo.map((e) => e.Id).join(",")}`;
    if (!todo.length || running.has(key)) return;
    running.add(key);
    let stopped = false;
    (async () => {
      setProgress({ left: todo.length, total: todo.length });
      const { saved, complete } = await fetchStills(seriesId, todo, {
        stopped: () => stopped,
        onProgress: (n, total) => setProgress({ left: total - n, total }),
      });
      if (complete) markSeasonsDone(user.Id, seriesId, todo, match || undefined);
      if (saved) {
        // New pictures have new image tags: lists, cards and the player pick them up.
        queryClient.invalidateQueries({ queryKey: ["episodes", seriesId] });
        queryClient.invalidateQueries({ queryKey: ["home"] });
      }
      setProgress({ left: 0, total: 0 });
    })().finally(() => running.delete(key));
    return () => {
      stopped = true;
    };
  }, [isAdmin, on, seriesId, episodes, queryClient, finished, matches, match, user]);

  return progress;
}
