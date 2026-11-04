import { useMemo } from "react";
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

function tvmazeSubtitle(e: UpcomingEntry): string {
  const when = e.date ? airDateLabel(e.date) : "";
  if (e.kind === "season") return `Season ${e.season} announced`;
  if (e.kind === "premiere") return joinDots([when, `Season ${e.season} premiere`]);
  return joinDots([when, `S${e.season}${e.episode !== undefined ? ` · E${e.episode}` : ""}`]);
}

/**
 * The Coming Up row: episodes Jellyfin knows are on the way, plus what the daily TVmaze
 * check found for shows Jellyfin has nothing scheduled for (including announced
 * seasons). One card per show, soonest first.
 */
export function useComingUp() {
  const server = useQuery({
    queryKey: ["home", "upcoming"],
    queryFn: async () => (await getUpcoming(60)).Items.filter((i) => i.PremiereDate),
    staleTime: 30 * 60_000,
  });
  const tvmaze = useUpcomingEntries();

  const covered = useMemo(() => new Set((server.data ?? []).map((i) => i.SeriesId ?? i.Id)), [server.data]);
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
    for (const item of server.data ?? []) {
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
  }, [server.data, series.data, extra]);

  return { cards, usesTvmaze: cards.some((c) => c.external) };
}
