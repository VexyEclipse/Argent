// Episode stills: for administrators, each episode's picture is replaced with its still from
// the library's metadata providers (TheMovieDb and the like) instead of a frame grabbed from
// the video, which can land on an opening or a title card. Jellyfin downloads and saves the
// still itself, so every app shows it; with "save artwork into media folders" on, that
// replaces the episode's -thumb.jpg beside the video. Each episode is done once, as its
// season is opened; one the providers have no still for keeps its picture.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { downloadRemoteImage, getRemoteImages, type RemoteImage } from "@/api/manage";
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
 * Replaces the pictures of a season's episodes with provider stills, one episode at a time,
 * while the season is on screen (administrators, when the setting is on). Reports how many
 * are left, for a progress line.
 */
export function useEpisodeStills(seriesId: string, episodes: BaseItem[] | undefined): { left: number; total: number } {
  const { isAdmin } = useAuth();
  const on = useStillsPref();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState({ left: 0, total: 0 });

  useEffect(() => {
    if (!isAdmin || !on || !episodes?.length) return;
    const done = new Set(readDone()[seriesId] ?? []);
    const todo = episodes.filter((e) => e.Type === "Episode" && e.LocationType !== "Virtual" && !done.has(e.Id));
    const key = `${seriesId}:${todo.map((e) => e.Id).join(",")}`;
    if (!todo.length || running.has(key)) return;
    running.add(key);
    let stopped = false;
    (async () => {
      setProgress({ left: todo.length, total: todo.length });
      let saved = 0;
      for (const [i, e] of todo.entries()) {
        if (stopped) break;
        try {
          const still = pickStill((await getRemoteImages(e.Id, "Primary")).Images);
          if (still?.Url) {
            await downloadRemoteImage(e.Id, "Primary", still.Url);
            saved++;
          }
          markDone(seriesId, [e.Id]);
        } catch {
          // Server or provider unreachable: stop, and try the rest next time.
          break;
        }
        setProgress({ left: todo.length - i - 1, total: todo.length });
        await sleep(GAP_MS);
      }
      if (saved) {
        logEvent("stills", `Saved ${saved} episode stills for series ${seriesId}`);
        // New pictures have new image tags: lists, cards and the player pick them up.
        queryClient.invalidateQueries({ queryKey: ["episodes", seriesId] });
        queryClient.invalidateQueries({ queryKey: ["home"] });
      }
      setProgress({ left: 0, total: 0 });
    })().finally(() => running.delete(key));
    return () => {
      stopped = true;
    };
  }, [isAdmin, on, seriesId, episodes, queryClient]);

  return progress;
}
