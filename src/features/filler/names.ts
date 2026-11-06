// Episode titles for anime episodes Jellyfin knows only by their file name ("Death Note
// - 01"). The title comes from the same MyAnimeList episode lists as filler, one page per
// 100 episodes, and is kept on this device. For administrators it's also saved to the
// episode in Jellyfin, so every app shows it and Argent never needs to look it up again.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { looksUnnamed } from "@/api/duplicates";
import { getEpisodes } from "@/api/jellyfin";
import { updateItemMetadata } from "@/api/manage";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { logEvent } from "@/features/diagnostics/log";
import { absoluteNumbers, EPISODES_PER_PAGE, locate } from "./logic";
import { episodeTitles, loadRun, useFillerPrefs } from "./store";

const NAMES_KEY = "argent.episodeNames";
const MAX_SHOWS = 200;

/** series id → episode id → { title, saved to Jellyfin } */
type NameCache = Record<string, Record<string, { name: string; saved?: boolean }>>;

function readNames(): NameCache {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

function writeNames(seriesId: string, names: NameCache[string]) {
  const all = readNames();
  delete all[seriesId];
  all[seriesId] = names;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SHOWS))) delete all[k];
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify(all));
  } catch {
    /* storage full: looked up again next time */
  }
}

/**
 * Episodes worth naming: real files, not specials, whose own title is only a file name or
 * number (the title shown may have come from another copy).
 */
const unnamed = (episodes: BaseItem[]) =>
  episodes.filter((e) => e.LocationType !== "Virtual" && (e.ParentIndexNumber ?? 1) > 0 && (e.BorrowedName || looksUnnamed(e)));

/**
 * Titles for a show's unnamed episodes, by episode id: from another copy of the episode
 * when one has a proper title, else from MyAnimeList by the episode's number (reading only
 * the pages those episodes are on, once). With `save`, each title is written to the episode
 * itself in Jellyfin (administrators); with `force` as well, even one saved before.
 */
export async function episodeNames(seriesId: string, save: boolean, force = false): Promise<Map<string, string>> {
  const episodes = (await getEpisodes(seriesId)).Items;
  const want = unnamed(episodes);
  if (!want.length) return new Map();
  const names = readNames()[seriesId] ?? {};
  for (const e of want) if (e.BorrowedName && !names[e.Id]) names[e.Id] = { name: e.Name };
  const missing = want.filter((e) => !names[e.Id]);

  if (missing.length) {
    const run = await loadRun(seriesId);
    if (run) {
      const numbers = absoluteNumbers(run.episodes);
      const pages = new Map<string, { malId: number; page: number; episodes: { id: string; number: number }[] }>();
      for (const e of missing) {
        const at = locate(numbers.get(e.Id) ?? 0, run.parts);
        if (!at) continue;
        const page = Math.floor((at.number - 1) / EPISODES_PER_PAGE) + 1;
        const key = `${at.malId}:${page}`;
        const entry = pages.get(key) ?? { malId: at.malId, page, episodes: [] };
        entry.episodes.push({ id: e.Id, number: at.number });
        pages.set(key, entry);
      }
      try {
        for (const { malId, page, episodes: eps } of pages.values()) {
          const titles = await episodeTitles(malId, page);
          for (const { id, number } of eps) if (titles[number]) names[id] = { name: titles[number] };
        }
      } catch {
        /* no service reachable: show what we have, try again next time */
      }
      writeNames(seriesId, names);
    }
  }

  if (save) {
    let saved = 0;
    for (const e of want) {
      const entry = names[e.Id];
      // `force`: saved before, but the episode has a file-name title again (a metadata refresh replaced it).
      if (!entry || (entry.saved && !force)) continue;
      try {
        await updateItemMetadata(e.Id, { Name: entry.name });
        entry.saved = true;
        saved++;
      } catch {
        break; // not allowed or unreachable: keep showing it here
      }
    }
    if (saved) {
      writeNames(seriesId, names);
      logEvent("names", `Saved ${saved} episode titles to Jellyfin for series ${seriesId}`);
    }
  }

  return new Map(want.filter((e) => names[e.Id]).map((e) => [e.Id, names[e.Id].name]));
}

/**
 * Titles for a show's episodes that only have a file name, by episode id (empty when none
 * need one, while loading, or when switched off). Administrators' lookups are saved to Jellyfin.
 */
export function useEpisodeNames(seriesId: string | undefined): Map<string, string> {
  const prefs = useFillerPrefs();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["episode-names", seriesId, isAdmin],
    queryFn: async () => {
      const names = await episodeNames(seriesId!, isAdmin);
      // Saved to Jellyfin: lists, the player and other apps now read the new titles.
      if (isAdmin && names.size) queryClient.invalidateQueries({ queryKey: ["episodes", seriesId] });
      return names;
    },
    enabled: Boolean(seriesId) && prefs.names,
    staleTime: 60 * 60_000,
    retry: false,
  });
  return q.data ?? EMPTY;
}

const EMPTY = new Map<string, string>();

/** An episode's title: the one looked up when Jellyfin has only a file name. */
export function useEpisodeTitle(item: Pick<BaseItem, "Id" | "Name" | "Type" | "SeriesId"> | null | undefined): string | undefined {
  const names = useEpisodeNames(item?.Type === "Episode" ? item.SeriesId : undefined);
  return item ? (names.get(item.Id) ?? item.Name) : undefined;
}
