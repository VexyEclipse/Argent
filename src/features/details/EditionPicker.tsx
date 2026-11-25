// A show kept in more than one edition (a Blu-ray and the first release, each in its own
// folder): which one the show page lists and Play plays, and which seasons are really just
// another edition's folder. See "editions" in api/duplicates.ts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chooseEdition, chosenEdition, copyOnlySeasons, editionsOf, hasCopies, type Edition } from "@/api/duplicates";
import { getEpisodes, getLibraryRoots } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { Icon } from "@/components/Icon";
import { resolutionLabel } from "@/features/player/streamPlan";

/** "1080p · Group": what tells an edition apart besides its name. */
export function editionDetail(e: Pick<Edition, "source" | "group" | "name">): string {
  const video = e.source?.MediaStreams?.find((s) => s.Type === "Video");
  return [resolutionLabel(video?.Width, video?.Height), e.group !== e.name && e.group].filter(Boolean).join(" · ");
}

/**
 * A show's editions, and the seasons to leave out because they only hold another
 * edition's copies. Only looked into when the seasons hint at copies: a season with no
 * number, two seasons with the same number, or copies seen on this show before.
 */
export function useEditions(series: BaseItem, seasons: BaseItem[] | undefined) {
  const numbers = seasons?.map((s) => s.IndexNumber) ?? [];
  const hint = numbers.some((n) => n === undefined || n === null) || new Set(numbers).size < numbers.length || hasCopies(series.Id);
  const query = useQuery({
    queryKey: ["episodes", series.Id, "editions"],
    queryFn: async () => {
      const [episodes, roots] = await Promise.all([getEpisodes(series.Id).then((r) => r.Items), getLibraryRoots()]);
      return { editions: editionsOf(episodes, roots), copyOnly: copyOnlySeasons(episodes) };
    },
    enabled: Boolean(seasons) && hint,
    staleTime: 60_000,
  });
  const copyOnly = query.data?.copyOnly;
  return {
    editions: query.data?.editions ?? [],
    /** The seasons worth a tab: a numbered season always is. */
    seasons: (seasons ?? []).filter((s) => (s.IndexNumber ?? null) !== null || !copyOnly?.has(s.Id)),
  };
}

export function EditionPicker({ seriesId, editions }: { seriesId: string; editions: Edition[] }) {
  const queryClient = useQueryClient();
  if (editions.length < 2) return null;
  const chosen = chosenEdition(seriesId);
  const current = editions.find((e) => e.folder === chosen) ?? editions.reduce((a, b) => (b.shown > a.shown ? b : a));
  return (
    <label className="hero__version">
      <span className="hero__version-label">
        <Icon name="layers" size={15} /> Edition
      </span>
      <select
        className="select select--compact"
        value={current.folder}
        onChange={(e) => {
          chooseEdition(seriesId, e.target.value);
          for (const key of [["episodes", seriesId], ["nextup", seriesId], ["play"]]) queryClient.invalidateQueries({ queryKey: key });
        }}
      >
        {editions.map((e) => {
          const detail = editionDetail(e);
          return (
            <option key={e.folder} value={e.folder}>
              {detail ? `${e.name} — ${detail}` : e.name}
            </option>
          );
        })}
      </select>
    </label>
  );
}
