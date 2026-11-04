import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { sortedIds } from "./logic";
import { useWatchlist } from "./store";

/** A series is done once every episode is watched; a film once it's played. */
export const isFinished = (item: BaseItem) => Boolean(item.UserData?.Played);

/**
 * Watchlist titles with their library metadata, newest additions first. Titles that
 * are no longer in the library (deleted, or on another server) are left out.
 */
export function useWatchlistItems() {
  const list = useWatchlist();
  const ids = useMemo(() => sortedIds(list), [list]);
  const query = useQuery({
    // Under "home" so whatever refreshes watch state (playback, watched toggles) refreshes this too.
    queryKey: ["home", "watchlist", ids],
    queryFn: async () => {
      if (!ids.length) return [];
      const r = await getItems({ ids, fields: CARD_FIELDS, enableImageTypes: ["Primary", "Backdrop", "Thumb", "Logo"] });
      const byId = new Map(r.Items.map((i) => [i.Id, i]));
      return ids.map((id) => byId.get(id)).filter((i): i is BaseItem => Boolean(i));
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return { ...query, count: ids.length };
}
