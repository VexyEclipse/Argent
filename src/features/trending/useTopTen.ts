import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems } from "@/api/jellyfin";
import { useLibraryIndex } from "@/api/libraryIndex";
import type { BaseItem } from "@/api/types";
import { buildLookup, findOwned, rankList, type Ranked, type TrendKind } from "./logic";
import { getTrending, keyPrint, TmdbKeyError, useTmdbKey, useTrendingPrefs } from "./store";

export interface TopRow extends Ranked {
  /** The library item to show, for a title you have. */
  item?: BaseItem;
}

/**
 * A trending list ranked for you: titles in your library as your own cards, the rest
 * (when shown) tagged "Not in library".
 */
export function useTopTen(kind: TrendKind | undefined, limit = 10) {
  const prefs = useTrendingPrefs();
  const { key } = useTmdbKey();
  const enabled = Boolean(kind) && (kind === "anime" || Boolean(key));
  const entries = useQuery({
    queryKey: ["trending", kind, kind === "anime" ? "" : keyPrint(key)],
    queryFn: () => getTrending(kind!, key),
    enabled,
    staleTime: 60 * 60_000,
    retry: (count, e) => !(e instanceof TmdbKeyError) && count < 1,
  });
  const index = useLibraryIndex(enabled);
  const lookup = useMemo(() => (index.data ? buildLookup(index.data) : null), [index.data]);
  // Without the index (it failed), nothing counts as yours rather than nothing showing.
  const indexDone = Boolean(lookup) || index.isError;

  const ranked = useMemo(() => {
    if (!entries.data || !indexDone) return null;
    const owned = new Map(entries.data.map((e) => [e.key, lookup ? findOwned(e, lookup) : undefined]));
    return rankList(entries.data, owned, { includeNotOwned: prefs.notOwned, limit });
  }, [entries.data, indexDone, lookup, prefs.notOwned, limit]);

  const ids = useMemo(() => (ranked ?? []).flatMap((r) => (r.ownedId ? [r.ownedId] : [])), [ranked]);
  const items = useQuery({
    queryKey: ["trending-items", ids],
    queryFn: () =>
      getItems({ ids, fields: CARD_FIELDS, enableImageTypes: ["Primary", "Backdrop", "Thumb", "Logo"] }).then((r) => new Map(r.Items.map((i) => [i.Id, i]))),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo<TopRow[]>(() => {
    if (!ranked) return [];
    if (ids.length && !items.data) return [];
    // An item the server didn't return (removed since, or hidden from you) isn't yours to play.
    const out: TopRow[] = [];
    for (const r of ranked) {
      const item = r.ownedId ? items.data?.get(r.ownedId) : undefined;
      if (r.ownedId && !item && !prefs.notOwned) continue;
      out.push({ ...r, rank: out.length + 1, ownedId: item ? r.ownedId : undefined, item });
    }
    return out;
  }, [ranked, ids.length, items.data, prefs.notOwned]);

  const pending = enabled && (entries.isPending || (!indexDone && index.isPending) || (ids.length > 0 && items.isPending));
  return { rows, pending, error: entries.error, keyRejected: entries.error instanceof TmdbKeyError };
}
