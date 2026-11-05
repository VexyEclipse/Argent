// NEW badges on series posters ("New season", "New episodes"), from the newest unwatched
// episodes in the library. One query for the whole app; each card reads its own badge.
// The same check tells reminded shows that their new episodes are ready to watch.

import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getItems } from "@/api/jellyfin";
import { episodeCode } from "@/api/format";
import { useAuth } from "@/auth/AuthProvider";
import { notify } from "@/platform/notify";
import { newArrivals, type NewArrival, type NewBadge } from "./logic";
import { readAnnounced, readReminders, writeAnnounced } from "./reminders";

let arrivals = new Map<string, NewArrival>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The badge for one series, if it has genuinely new episodes. */
export function useNewBadge(seriesId: string): NewBadge | undefined {
  return useSyncExternalStore(subscribe, () => arrivals.get(seriesId)?.badge);
}

/** Runs the check (in the shell): refreshed every few minutes and after playback. */
export function useNewArrivalsSync() {
  const { user } = useAuth();
  const userId = user?.Id;
  const query = useQuery({
    queryKey: ["home", "new-arrivals"],
    queryFn: async () => {
      const r = await getItems({
        includeItemTypes: ["Episode"],
        recursive: true,
        isPlayed: false,
        sortBy: ["DateCreated"],
        sortOrder: "Descending",
        limit: 200,
        fields: ["DateCreated", "PremiereDate"],
        enableImageTypes: [],
      });
      return r.Items;
    },
    enabled: Boolean(userId),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });

  useEffect(() => {
    if (!query.data || !userId) return;
    arrivals = newArrivals(query.data);
    listeners.forEach((fn) => fn());
    announceArrivals(userId, query.data);
  }, [query.data, userId]);
}

/** "It's here": a reminded show's new episodes reached the library since you asked. */
function announceArrivals(userId: string, episodes: { SeriesName?: string; SeriesId?: string }[]) {
  const reminders = readReminders(userId);
  const announced = readAnnounced(userId);
  let changed = false;
  for (const [seriesId, arrival] of arrivals) {
    const reminder = reminders[seriesId];
    if (!reminder || announced[seriesId] === arrival.latest.Id) continue;
    announced[seriesId] = arrival.latest.Id;
    changed = true;
    // Already in the library when the reminder was set: not news.
    if (Date.parse(arrival.latest.DateCreated ?? "") < reminder.at) continue;
    const name = episodes.find((e) => e.SeriesId === seriesId)?.SeriesName ?? reminder.name;
    const code = episodeCode({ ...arrival.latest, Type: "Episode" });
    notify({
      title: name,
      body: arrival.badge === "New season" || arrival.badge === "New series" ? `${arrival.badge} is ready to watch` : `${code} is ready to watch`,
      path: `/details/${seriesId}`,
      tag: `arrival-${seriesId}`,
    });
  }
  if (changed) writeAnnounced(userId, announced);
}
