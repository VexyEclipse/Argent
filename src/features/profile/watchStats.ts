// Lifetime viewing stats from Jellyfin's played flags. Jellyfin keeps a play count per
// title, not a log of sessions, so watch time is runtime × plays: an estimate.

import { getItems } from "@/api/jellyfin";
import { TICKS_PER_SECOND } from "@/api/format";
import type { BaseItem } from "@/api/types";

export interface WatchStats {
  hours: number;
  movieHours: number;
  episodeHours: number;
  movies: number;
  episodes: number;
  seriesStarted: number;
  seriesFinished: number;
  /** Extra plays beyond the first, across films and episodes. */
  rewatches: number;
  anime: { titles: number; episodes: number; hours: number };
  topGenres: { name: string; hours: number }[];
  mostWatched: { id: string; name: string; episodes: number; hours: number } | null;
  /** Films and series last played this calendar year. */
  thisYear: number;
}

const hoursOf = (item: BaseItem) => ((item.RunTimeTicks ?? 0) / TICKS_PER_SECOND / 3600) * Math.max(1, item.UserData?.PlayCount ?? 1);

export function computeWatchStats(
  input: { movies: BaseItem[]; episodes: BaseItem[]; series: BaseItem[]; animeIds: Set<string> },
  now = new Date(),
): WatchStats {
  const { movies, episodes, series, animeIds } = input;
  const year = now.getFullYear();
  const seriesById = new Map(series.map((s) => [s.Id, s]));
  const genreHours = new Map<string, number>();
  const addGenres = (genres: string[] | undefined, h: number) => genres?.forEach((g) => genreHours.set(g, (genreHours.get(g) ?? 0) + h));
  const playedThisYear = (i: BaseItem) => Boolean(i.UserData?.LastPlayedDate && new Date(i.UserData.LastPlayedDate).getFullYear() === year);

  let movieHours = 0;
  let rewatches = 0;
  let thisYear = 0;
  const anime = { titles: 0, episodes: 0, hours: 0 };
  for (const m of movies) {
    const h = hoursOf(m);
    movieHours += h;
    rewatches += Math.max(0, (m.UserData?.PlayCount ?? 1) - 1);
    addGenres(m.Genres, h);
    if (playedThisYear(m)) thisYear++;
    if (animeIds.has(m.Id)) {
      anime.titles++;
      anime.hours += h;
    }
  }

  let episodeHours = 0;
  const perSeries = new Map<string, { episodes: number; hours: number; thisYear: boolean }>();
  for (const e of episodes) {
    const h = hoursOf(e);
    episodeHours += h;
    rewatches += Math.max(0, (e.UserData?.PlayCount ?? 1) - 1);
    if (!e.SeriesId) continue;
    const s = perSeries.get(e.SeriesId) ?? { episodes: 0, hours: 0, thisYear: false };
    s.episodes++;
    s.hours += h;
    s.thisYear ||= playedThisYear(e);
    perSeries.set(e.SeriesId, s);
    addGenres(seriesById.get(e.SeriesId)?.Genres, h);
    if (animeIds.has(e.SeriesId)) {
      anime.episodes++;
      anime.hours += h;
    }
  }

  let mostWatched: WatchStats["mostWatched"] = null;
  for (const [id, s] of perSeries) {
    if (s.thisYear) thisYear++;
    if (animeIds.has(id)) anime.titles++;
    if (!mostWatched || s.hours > mostWatched.hours) {
      const name = seriesById.get(id)?.Name ?? episodes.find((e) => e.SeriesId === id)?.SeriesName ?? "";
      mostWatched = { id, name, episodes: s.episodes, hours: s.hours };
    }
  }

  return {
    hours: movieHours + episodeHours,
    movieHours,
    episodeHours,
    movies: movies.length,
    episodes: episodes.length,
    seriesStarted: perSeries.size,
    seriesFinished: series.filter((s) => s.UserData?.Played && perSeries.has(s.Id)).length,
    rewatches,
    anime,
    topGenres: [...genreHours]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, hours]) => ({ name, hours })),
    mostWatched,
    thisYear,
  };
}

const LEAN = { recursive: true, enableImageTypes: [], enableTotalRecordCount: false };

/** Ids of every film and series in the anime libraries. */
export async function fetchAnimeIds(libraryIds: string[]): Promise<Set<string>> {
  const results = await Promise.all(
    libraryIds.map((parentId) => getItems({ ...LEAN, parentId, includeItemTypes: ["Movie", "Series"], fields: [], enableUserData: false })),
  );
  return new Set(results.flatMap((r) => r.Items.map((i) => i.Id)));
}

export async function fetchWatchStats(animeIds: Set<string>): Promise<WatchStats> {
  const [movies, episodes, series] = await Promise.all([
    getItems({ ...LEAN, includeItemTypes: ["Movie"], isPlayed: true, fields: ["Genres"] }),
    getItems({ ...LEAN, includeItemTypes: ["Episode"], isPlayed: true, fields: [] }),
    getItems({ ...LEAN, includeItemTypes: ["Series"], fields: ["Genres"] }),
  ]);
  return computeWatchStats({ movies: movies.Items, episodes: episodes.Items, series: series.Items, animeIds });
}
