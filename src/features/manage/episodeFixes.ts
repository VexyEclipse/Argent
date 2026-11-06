// "Fix episode titles and pictures" (Refresh metadata): Argent's own episode fixes, for a
// whole show, a season or an episode at once rather than season by season as they're
// opened. Titles that are only a file name get their proper title, saved to Jellyfin; every
// episode gets its provider still, even one done before. It waits for Jellyfin's own
// refresh to settle first, so that doesn't overwrite them, and runs in the background.

import type { QueryClient } from "@tanstack/react-query";
import { copyIds } from "@/api/duplicates";
import { getEpisodes, getItem } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { showToast } from "@/components/Toast";
import { episodeNames } from "@/features/filler/names";
import { fetchStills, markSeasonsDone, matchKey } from "./stills";

/** Long enough for Jellyfin to finish refreshing a typical show before the fixes start. */
const SETTLE_MS = { scan: 5_000, other: 30_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Which shows, seasons or episodes the chosen items stand for. A season is matched by its
 * number (a show scanned from several folders has a season item per folder), an episode by
 * its id or any of its copies.
 */
export function targets(items: BaseItem[]) {
  const out = new Map<string, { name: string; whole: boolean; seasons: Set<number>; episodes: Set<string> }>();
  for (const i of items) {
    const seriesId = i.Type === "Series" ? i.Id : i.SeriesId;
    if (!seriesId || !["Series", "Season", "Episode"].includes(i.Type)) continue;
    const t = out.get(seriesId) ?? { name: i.Type === "Series" ? i.Name : (i.SeriesName ?? i.Name), whole: false, seasons: new Set(), episodes: new Set() };
    if (i.Type === "Series") t.whole = true;
    else if (i.Type === "Season") t.seasons.add(i.IndexNumber ?? 0);
    else t.episodes.add(i.Id);
    out.set(seriesId, t);
  }
  return out;
}

export const canFixEpisodes = (items: BaseItem[]) => targets(items).size > 0;

export async function fixEpisodes(items: BaseItem[], opts: { userId: string; afterScanOnly: boolean; queryClient: QueryClient }) {
  const shows = targets(items);
  if (!shows.size) return;
  await sleep(opts.afterScanOnly ? SETTLE_MS.scan : SETTLE_MS.other);
  let titles = 0;
  let pictures = 0;
  let stoppedAt: string | null = null;
  for (const [seriesId, t] of shows) {
    const all = (await getEpisodes(seriesId).catch(() => ({ Items: [] as BaseItem[] }))).Items;
    const episodes = all.filter(
      (e) =>
        e.LocationType !== "Virtual" &&
        (t.whole || t.seasons.has(e.ParentIndexNumber ?? 0) || copyIds(e).some((id) => t.episodes.has(id))),
    );
    titles += (await episodeNames(seriesId, true, true).catch(() => new Map())).size;
    const { saved, complete } = await fetchStills(seriesId, episodes, {
      onProgress: (n, total) => n % 5 === 0 && n < total && showToast(`Episode pictures for ${t.name}: ${n} of ${total}`),
    });
    pictures += saved;
    const series = await getItem(seriesId, ["ProviderIds"]).catch(() => null);
    if (complete) markSeasonsDone(opts.userId, seriesId, episodes, series ? matchKey(series.ProviderIds) || undefined : undefined);
    else {
      stoppedAt = t.name;
      break;
    }
  }
  opts.queryClient.invalidateQueries({ queryKey: ["episodes"] });
  opts.queryClient.invalidateQueries({ queryKey: ["episode-names"] });
  opts.queryClient.invalidateQueries({ queryKey: ["home"] });
  const summary = `${titles} ${titles === 1 ? "title" : "titles"} and ${pictures} ${pictures === 1 ? "picture" : "pictures"} updated`;
  showToast(stoppedAt ? `Stopped at ${stoppedAt}: the server or TheMovieDb didn't answer. ${summary}.` : `Episodes fixed: ${summary}.`);
}
