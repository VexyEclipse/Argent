// Shows taken out of Next Up ("Remove from row"). Jellyfin has no such setting, so each is
// kept as series → the episode Next Up offered, and comes back by itself once Next Up
// moves on to another episode (you watched something of it elsewhere). Synced through the
// user's Jellyfin DisplayPreferences.

import { useMemo } from "react";
import { updateUserData } from "@/api/jellyfin";
import { createSyncedMap } from "@/api/syncedMap";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";

const hiddenNextUp = createSyncedMap<string>({ prefsId: "argent-home", field: "hiddenNextUp", storageKey: "argent.hiddenNextUp", max: 300 });

/** Next Up minus the shows taken out of it, plus a way to take one out. */
export function useHiddenNextUp() {
  const { user } = useAuth();
  const userId = user?.Id ?? "";
  const hidden = hiddenNextUp.use();
  return useMemo(
    () => ({
      isHidden: (episode: BaseItem) => Boolean(episode.SeriesId && hidden[episode.SeriesId] === episode.Id),
      hide: (episode: BaseItem) => userId && episode.SeriesId && hiddenNextUp.set(userId, episode.SeriesId, episode.Id),
      unhide: (episode: BaseItem) => userId && episode.SeriesId && hiddenNextUp.remove(userId, episode.SeriesId),
    }),
    [hidden, userId],
  );
}

/**
 * Takes a title out of Continue Watching by clearing its resume point on the server, so
 * every app agrees. Resolves to an undo that puts the resume point back.
 */
export async function clearResumePoint(item: BaseItem): Promise<() => Promise<void>> {
  const position = item.UserData?.PlaybackPositionTicks ?? 0;
  await updateUserData(item.Id, { PlaybackPositionTicks: 0 });
  return async () => {
    await updateUserData(item.Id, { PlaybackPositionTicks: position });
  };
}
