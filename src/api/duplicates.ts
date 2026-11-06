// Duplicate episodes: when the same episode is in the library more than once (a folder
// scanned twice, a second release, or items left behind by a folder that was removed),
// Jellyfin lists each as its own episode. Argent shows one per season and number: the
// most complete copy, carrying the watch state of them all.

import type { BaseItem } from "./types";

/** How good a copy is to show and play: artwork and details mean it was scanned properly. */
function score(e: BaseItem): number {
  let s = 0;
  if (e.LocationType !== "Virtual") s += 8;
  if (e.ImageTags?.Primary) s += 4;
  if ((e.UserData?.PlaybackPositionTicks ?? 0) > 0) s += 2;
  if (e.Overview) s += 1;
  return s;
}

const keyOf = (e: BaseItem) =>
  e.IndexNumber === undefined ? null : `${e.ParentIndexNumber ?? ""}:${e.IndexNumber}:${e.IndexNumberEnd ?? ""}`;

/**
 * One episode per season and number, in the original order. A placeholder for a missing
 * episode gives way to a real file. The copy kept lists the others in `Copies`, is watched
 * if any copy is, and resumes from wherever one was left part-way.
 */
export function mergeDuplicateEpisodes(episodes: BaseItem[]): BaseItem[] {
  const groups = new Map<string, BaseItem[]>();
  for (const e of episodes) {
    const key = keyOf(e);
    if (key) groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: BaseItem[] = [];
  const done = new Set<string>();
  for (const e of episodes) {
    const key = keyOf(e);
    const group = key ? groups.get(key)! : [e];
    if (group.length === 1) {
      out.push(e);
      continue;
    }
    if (done.has(key!)) continue;
    done.add(key!);
    const best = group.reduce((a, b) => (score(b) > score(a) ? b : a));
    const others = group.filter((x) => x !== best && x.LocationType !== "Virtual");
    const resume = [best, ...others].find((x) => (x.UserData?.PlaybackPositionTicks ?? 0) > 0);
    out.push({
      ...best,
      UserData: {
        ...best.UserData,
        Played: group.some((x) => x.UserData?.Played),
        PlaybackPositionTicks: resume?.UserData?.PlaybackPositionTicks ?? best.UserData?.PlaybackPositionTicks,
        PlayedPercentage: resume?.UserData?.PlayedPercentage ?? best.UserData?.PlayedPercentage,
      },
      Copies: others.length ? others.map((x) => ({ Id: x.Id, Path: x.MediaSources?.[0]?.Path })) : undefined,
    });
  }
  return out;
}

/** Every library item behind an episode row: the one shown and its hidden copies. */
export const copyIds = (e: Pick<BaseItem, "Id" | "Copies">) => [e.Id, ...(e.Copies?.map((c) => c.Id) ?? [])];
