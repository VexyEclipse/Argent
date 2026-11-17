// A light list of every film and series the user can see: names, ids and whether it's in
// an anime library. Top 10 uses it to tell which trending titles you own, and Smart Search
// to find a title despite a typo. No artwork or user data, so it stays small.

import { useQuery } from "@tanstack/react-query";
import { getItems } from "./jellyfin";
import { useLibraryGroups } from "./libraries";
import type { BaseItem } from "./types";

export interface IndexEntry {
  id: string;
  type: "Movie" | "Series";
  name: string;
  original?: string;
  year?: number;
  ids: Record<string, string>;
  anime: boolean;
}

const PAGE = 2000;

async function allIds(query: Parameters<typeof getItems>[0]): Promise<BaseItem[]> {
  const out: BaseItem[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = await getItems({ ...query, startIndex: start, limit: PAGE, enableTotalRecordCount: true });
    out.push(...page.Items);
    if (page.Items.length < PAGE || out.length >= page.TotalRecordCount) return out;
  }
}

const LIGHT = { recursive: true, enableImages: false, enableUserData: false, enableImageTypes: undefined, imageTypeLimit: undefined };

export async function fetchLibraryIndex(animeLibraryIds: string[]): Promise<IndexEntry[]> {
  const [items, ...animeLists] = await Promise.all([
    allIds({ ...LIGHT, includeItemTypes: ["Movie", "Series"], fields: ["ProviderIds", "OriginalTitle"] }),
    ...animeLibraryIds.map((parentId) => allIds({ ...LIGHT, parentId, includeItemTypes: ["Movie", "Series"] })),
  ]);
  const anime = new Set(animeLists.flat().map((i) => i.Id));
  return items
    .filter((i) => i.Type === "Movie" || i.Type === "Series")
    .map((i) => ({
      id: i.Id,
      type: i.Type as "Movie" | "Series",
      name: i.Name,
      original: i.OriginalTitle && i.OriginalTitle !== i.Name ? i.OriginalTitle : undefined,
      year: i.ProductionYear,
      ids: i.ProviderIds ?? {},
      anime: anime.has(i.Id),
    }));
}

export function useLibraryIndex(enabled = true) {
  const groups = useLibraryGroups();
  const animeIds = groups.anime.map((l) => l.Id);
  return useQuery({
    queryKey: ["library-index", animeIds],
    queryFn: () => fetchLibraryIndex(animeIds),
    enabled: enabled && !groups.isPending,
    staleTime: 30 * 60_000,
  });
}
