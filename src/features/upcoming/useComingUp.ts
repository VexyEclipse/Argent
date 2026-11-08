import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems, getUpcoming } from "@/api/jellyfin";
import { airDateLabel, episodeCode, joinDots } from "@/api/format";
import type { BaseItem } from "@/api/types";
import type { UpcomingEntry } from "./logic";
import { useUpcomingEntries } from "./store";

export interface ComingUpCard {
  key: string;
  item: BaseItem;
  subtitle: string;
  /** From TVmaze (a series card) rather than an episode Jellyfin already lists. */
  external: boolean;
}

const MAX_CARDS = 24;
/** How far back to look for episodes that already arrived in the library. */
const OWNED_LOOKBACK_DAYS = 7;

function tvmazeSubtitle(e: UpcomingEntry): string {
  const when = e.date ? airDateLabel(e.date) : "";
  if (e.kind === "season") return `Season ${e.season} announced`;
  if (e.kind === "premiere") return joinDots([when, `Season ${e.season} premiere`]);
  return joinDots([when, `S${e.season}${e.episode !== undefined ? ` · E${e.episode}` : ""}`]);
}

const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** A real file (or a strm/disc), not a placeholder Jellyfin made from the show's episode list. */
const inLibrary = (item: BaseItem) => (item.LocationType ? item.LocationType !== "Virtual" : Boolean(item.Path));

/**
 * The Coming Up row: episodes Jellyfin knows are on the way, plus what the daily TVmaze
 * check found for shows Jellyfin has nothing scheduled for (including announced
 * seasons). One card per show, soonest first. An episode stays until its air date has
 * passed, and drops out as soon as it's in your library.
 */
export function useComingUp() {
  const server = useQuery({
    queryKey: ["home", "upcoming"],
    queryFn: async () => (await getUpcoming(60)).Items.filter((i) => i.PremiereDate),
    staleTime: 30 * 60_000,
  });

  // Episodes that aired lately and are already in the library, to drop from the schedule.
  const owned = useQuery({
    queryKey: ["home", "upcoming-owned"],
    queryFn: async () => {
      const since = new Date(startOfToday() - OWNED_LOOKBACK_DAYS * 86_400_000).toISOString();
      const r = await getItems({
        includeItemTypes: ["Episode"],
        recursive: true,
        minPremiereDate: since,
        isMissing: false,
        fields: ["Path"],
        enableImageTypes: [],
        enableUserData: false,
        limit: 1000,
      });
      return r.Items.filter(inLibrary)
        .filter((e) => e.SeriesId && e.ParentIndexNumber !== undefined && e.IndexNumber !== undefined)
        .map((e) => `${e.SeriesId}:${e.ParentIndexNumber}:${e.IndexNumber}`);
    },
    staleTime: 10 * 60_000,
  });
  const ownedSet = useMemo(() => new Set(owned.data ?? []), [owned.data]);
  const have = useCallback((seriesId: string, season: number, episode: number) => ownedSet.has(`${seriesId}:${season}:${episode}`), [ownedSet]);

  const tvmaze = useUpcomingEntries(have);

  // Jellyfin's list starts at yesterday and includes episodes you already have: keep only
  // ones still to come (or airing today) that aren't in the library yet.
  const today = startOfToday();
  const upcoming = useMemo(
    () => (server.data ?? []).filter((i) => !inLibrary(i) && dayOf(i.PremiereDate!) >= today),
    [server.data, today],
  );

  const covered = useMemo(() => new Set(upcoming.map((i) => i.SeriesId ?? i.Id)), [upcoming]);
  const extra = useMemo(() => tvmaze.entries.filter((e) => !covered.has(e.seriesId)), [tvmaze.entries, covered]);
  const ids = useMemo(() => extra.map((e) => e.seriesId).sort(), [extra]);

  const series = useQuery({
    queryKey: ["home", "upcoming-series", ids],
    queryFn: () => getItems({ ids, fields: CARD_FIELDS }).then((r) => r.Items),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });

  const cards = useMemo(() => {
    const dated: { at: number; card: ComingUpCard }[] = [];
    const undated: ComingUpCard[] = [];
    const seen = new Set<string>();
    for (const item of upcoming) {
      const key = item.SeriesId ?? item.Id;
      if (seen.has(key)) continue;
      seen.add(key);
      dated.push({
        at: Date.parse(item.PremiereDate!),
        card: { key: item.Id, item, subtitle: joinDots([airDateLabel(item.PremiereDate), episodeCode(item)]), external: false },
      });
    }
    const byId = new Map((series.data ?? []).map((s) => [s.Id, s]));
    for (const e of extra) {
      const item = byId.get(e.seriesId);
      if (!item || seen.has(e.seriesId)) continue;
      seen.add(e.seriesId);
      const card = { key: `tvmaze-${e.seriesId}`, item, subtitle: tvmazeSubtitle(e), external: true };
      if (e.date) dated.push({ at: Date.parse(e.date), card });
      else undated.push(card);
    }
    return [...dated.sort((a, b) => a.at - b.at).map((d) => d.card), ...undated].slice(0, MAX_CARDS);
  }, [upcoming, series.data, extra]);

  return { cards };
}
