import type { BaseItem } from "@/api/types";

/**
 * Unwatched episodes that come before `targetId` in series order, for "mark the earlier
 * ones watched too". Specials and episodes that aren't in the library are left alone.
 */
export function earlierUnwatched(episodes: BaseItem[], targetId: string): BaseItem[] {
  const regular = episodes.filter((e) => (e.ParentIndexNumber ?? 1) > 0 && e.LocationType !== "Virtual");
  const index = regular.findIndex((e) => e.Id === targetId);
  if (index <= 0) return [];
  return regular.slice(0, index).filter((e) => !e.UserData?.Played);
}
