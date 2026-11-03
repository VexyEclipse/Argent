import { getItems, getSimilar } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { buildProfile, libraryStats, topPeople, type EngineItem, type ExternalSignals, type Feedback, type HistorySignal } from "./engine";

const DAY = 86_400_000;
const LIBRARY_FIELDS = ["Genres", "Tags", "Studios", "DateCreated", "PrimaryImageAspectRatio", "ChildCount", "RecursiveItemCount"];
const HISTORY_FIELDS = [...LIBRARY_FIELDS, "People"];

const ms = (date?: string) => (date ? Date.parse(date) || undefined : undefined);

export function toEngineItem(item: BaseItem): EngineItem {
  const u = item.UserData ?? {};
  const progress = u.PlaybackPositionTicks && item.RunTimeTicks ? Math.min(1, u.PlaybackPositionTicks / item.RunTimeTicks) : 0;
  return {
    id: item.Id,
    type: item.Type === "Series" ? "Series" : "Movie",
    name: item.Name,
    genres: item.Genres ?? [],
    tags: item.Tags ?? [],
    studios: (item.Studios ?? []).map((s) => s.Name),
    people: (item.People ?? [])
      .filter((p) => p.Type === "Actor" || p.Type === "Director" || p.Type === "Writer")
      .map((p, i, all) => ({
        id: p.Id,
        name: p.Name,
        role: p.Type as "Actor" | "Director" | "Writer",
        order: p.Type === "Actor" ? all.slice(0, i).filter((q) => q.Type === "Actor").length : 0,
      })),
    year: item.ProductionYear,
    communityRating: item.CommunityRating,
    criticRating: item.CriticRating,
    officialRating: item.OfficialRating,
    runtimeMinutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) : undefined,
    dateAdded: ms(item.DateCreated),
    user: {
      played: Boolean(u.Played),
      playCount: u.PlayCount ?? 0,
      lastPlayed: ms(u.LastPlayedDate),
      progress: item.Type === "Series" ? 0 : progress,
      favorite: Boolean(u.IsFavorite),
      likes: u.Likes ?? null,
      rating: typeof u.Rating === "number" ? u.Rating : undefined,
    },
    episodesTotal: item.Type === "Series" ? item.RecursiveItemCount : undefined,
    episodesWatched:
      item.Type === "Series" && u.PlayedPercentage && item.RecursiveItemCount ? Math.round((u.PlayedPercentage / 100) * item.RecursiveItemCount) : undefined,
  };
}

async function fetchAll(query: Parameters<typeof getItems>[0], pageSize = 1500): Promise<BaseItem[]> {
  const out: BaseItem[] = [];
  for (let start = 0; ; start += pageSize) {
    const page = await getItems({ ...query, startIndex: start, limit: pageSize, enableTotalRecordCount: true });
    out.push(...page.Items);
    if (page.Items.length < pageSize || out.length >= page.TotalRecordCount) break;
  }
  return out;
}

/** Every movie and series the user can see, with the metadata the engine scores on. */
export function fetchLibrary(): Promise<BaseItem[]> {
  return fetchAll({
    includeItemTypes: ["Movie", "Series"],
    recursive: true,
    fields: LIBRARY_FIELDS,
    enableImageTypes: ["Primary", "Backdrop", "Thumb", "Logo"],
    collapseBoxSetItems: false,
  });
}

export interface History {
  signals: HistorySignal[];
  /** Series the user has started (for exclusion even if the series UserData lags). */
  startedSeries: Set<string>;
  /** Changes whenever new viewing activity is recorded. */
  signature: string;
}

export async function fetchHistory(now = Date.now()): Promise<History> {
  const [playedMovies, resumable, playedEpisodes, resumableEpisodes, favourites] = await Promise.all([
    getItems({
      includeItemTypes: ["Movie"],
      recursive: true,
      isPlayed: true,
      sortBy: ["DatePlayed"],
      sortOrder: "Descending",
      limit: 400,
      fields: HISTORY_FIELDS,
    }),
    getItems({
      includeItemTypes: ["Movie"],
      recursive: true,
      filters: ["IsResumable"],
      sortBy: ["DatePlayed"],
      sortOrder: "Descending",
      limit: 100,
      fields: HISTORY_FIELDS,
    }),
    getItems({
      includeItemTypes: ["Episode"],
      recursive: true,
      isPlayed: true,
      sortBy: ["DatePlayed"],
      sortOrder: "Descending",
      limit: 4000,
      enableImageTypes: [],
    }),
    getItems({ includeItemTypes: ["Episode"], recursive: true, filters: ["IsResumable"], limit: 200, enableImageTypes: [] }),
    getItems({ includeItemTypes: ["Movie", "Series"], recursive: true, isFavorite: true, limit: 200, fields: HISTORY_FIELDS }),
  ]);

  const signals: HistorySignal[] = [];
  const seen = new Set<string>();

  for (const item of playedMovies.Items) {
    seen.add(item.Id);
    const e = toEngineItem(item);
    signals.push({ item: e, completion: 1, plays: Math.max(1, e.user.playCount), lastPlayed: e.user.lastPlayed });
  }
  for (const item of resumable.Items) {
    if (seen.has(item.Id)) continue;
    seen.add(item.Id);
    const e = toEngineItem(item);
    const stale = e.user.lastPlayed ? now - e.user.lastPlayed > 30 * DAY : false;
    signals.push({ item: e, completion: e.user.progress, plays: 1, lastPlayed: e.user.lastPlayed, abandoned: stale && e.user.progress < 0.25 });
  }

  // Aggregate episodes into one signal per series.
  const perSeries = new Map<string, { episodes: number; plays: number; last?: number }>();
  for (const ep of [...playedEpisodes.Items, ...resumableEpisodes.Items]) {
    if (!ep.SeriesId) continue;
    const cur = perSeries.get(ep.SeriesId) ?? { episodes: 0, plays: 0 };
    cur.episodes += ep.UserData?.Played ? 1 : 0.5;
    cur.plays += Math.max(1, ep.UserData?.PlayCount ?? 1);
    const last = ms(ep.UserData?.LastPlayedDate);
    if (last && (!cur.last || last > cur.last)) cur.last = last;
    perSeries.set(ep.SeriesId, cur);
  }
  const seriesIds = [...perSeries.keys()];
  const seriesItems: BaseItem[] = [];
  for (let i = 0; i < seriesIds.length; i += 150) {
    const chunk = seriesIds.slice(i, i + 150);
    const r = await getItems({ ids: chunk, fields: HISTORY_FIELDS });
    seriesItems.push(...r.Items);
  }
  for (const s of seriesItems) {
    const agg = perSeries.get(s.Id)!;
    seen.add(s.Id);
    const e = toEngineItem(s);
    const total = e.episodesTotal || agg.episodes;
    signals.push({
      item: e,
      completion: Math.min(1, agg.episodes / Math.max(1, total)),
      // Rewatching episodes shows up as more plays than episodes.
      plays: agg.plays > agg.episodes * 1.2 ? 2 : 1,
      lastPlayed: agg.last,
      episodes: agg.episodes,
    });
  }

  // Favourites the user hasn't watched still express taste.
  for (const item of favourites.Items) {
    if (seen.has(item.Id)) continue;
    const e = toEngineItem(item);
    signals.push({ item: e, completion: 0.5, plays: 0, lastPlayed: e.user.lastPlayed });
  }

  const latest = Math.max(0, ...signals.map((s) => s.lastPlayed ?? 0));
  return {
    signals,
    startedSeries: new Set(seriesIds),
    signature: `${signals.length}:${latest}:${playedEpisodes.Items.length}`,
  };
}

/** Server-side signals: other titles by the user's people, and Jellyfin's own similarity. */
export async function fetchSignals(history: HistorySignal[], library: BaseItem[], feedback: Feedback): Promise<ExternalSignals> {
  const engineLibrary = library.map(toEngineItem);
  const profile = buildProfile(history, libraryStats(engineLibrary), feedback);
  const people = topPeople(profile);
  const seeds = profile.seeds.slice(0, 8);
  const libraryIds = new Set(library.map((i) => i.Id));

  const personHits = new Map<string, string[]>();
  const similarHits = new Map<string, { seedId: string; rank: number; of: number }[]>();

  // Limit concurrency: a handful of small requests at a time.
  const tasks: (() => Promise<void>)[] = [
    ...people.map((p) => async () => {
      const r = await getItems({
        personIds: [p.id],
        includeItemTypes: ["Movie", "Series"],
        recursive: true,
        limit: 80,
        enableImageTypes: [],
        enableUserData: false,
      });
      for (const item of r.Items) {
        if (!libraryIds.has(item.Id)) continue;
        const list = personHits.get(item.Id) ?? [];
        list.push(p.id);
        personHits.set(item.Id, list);
      }
    }),
    ...seeds.map((seed) => async () => {
      const r = await getSimilar(seed.item.id, 24);
      r.Items.forEach((item, rank) => {
        if (!libraryIds.has(item.Id)) return;
        const list = similarHits.get(item.Id) ?? [];
        list.push({ seedId: seed.item.id, rank, of: r.Items.length });
        similarHits.set(item.Id, list);
      });
    }),
  ];
  const queue = [...tasks];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const task = queue.shift()!;
        try {
          await task();
        } catch {
          /* one failed lookup shouldn't sink the rest */
        }
      }
    }),
  );
  return { personHits, similarHits };
}
