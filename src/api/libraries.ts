import { useQuery } from "@tanstack/react-query";
import { getViews } from "./jellyfin";
import type { BaseItem } from "./types";

export type LibraryGroup = "movies" | "series" | "anime";

/**
 * Jellyfin has no "anime" library type; anime libraries are ordinary TV or movie
 * libraries, so they are recognised by name.
 */
export function isAnimeLibrary(view: Pick<BaseItem, "Name">): boolean {
  return /anime|アニメ/i.test(view.Name);
}

/** The user's libraries split into Movies, Series (non-anime TV) and Anime. */
export function useLibraryGroups() {
  const views = useQuery({ queryKey: ["views"], queryFn: getViews, staleTime: 5 * 60_000 });
  const items = views.data?.Items ?? [];
  const groups: Record<LibraryGroup, BaseItem[]> = {
    anime: items.filter((v) => (v.CollectionType === "tvshows" || v.CollectionType === "movies" || v.CollectionType === "mixed") && isAnimeLibrary(v)),
    movies: items.filter((v) => v.CollectionType === "movies" && !isAnimeLibrary(v)),
    series: items.filter((v) => v.CollectionType === "tvshows" && !isAnimeLibrary(v)),
  };
  return { ...groups, isPending: views.isPending };
}
