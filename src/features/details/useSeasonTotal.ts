import { useQuery } from "@tanstack/react-query";
import { seasonTotal } from "@/api/format";
import { getSeasons } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";

/**
 * A show's real seasons (see seasonTotal), once its seasons have loaded; undefined for
 * anything else. Jellyfin's own count (ChildCount) takes in Specials and folders that
 * aren't seasons. Shares the show page's season list.
 */
export function useSeasonTotal(item: BaseItem): number | undefined {
  const series = item.Type === "Series";
  const seasons = useQuery({
    queryKey: ["seasons", item.Id],
    queryFn: () => getSeasons(item.Id).then((r) => r.Items),
    enabled: series && Boolean(item.ChildCount),
    staleTime: 60_000,
  });
  return series && seasons.data ? seasonTotal(seasons.data) : undefined;
}
