import { useQuery } from "@tanstack/react-query";
import { getItem } from "@/api/jellyfin";
import { logoImage } from "@/api/images";
import { episodeCode, formatRuntime, joinDots, yearOf } from "@/api/format";
import type { BaseItem } from "@/api/types";
import { FillerBadge } from "@/features/filler/FillerBadge";
import { useEpisodeTitle } from "@/features/filler/names";
import { useFillerIds } from "@/features/filler/store";

/**
 * "You're watching": after a few seconds paused, the picture dims and this says what's
 * playing, with the synopsis and who's in it. Any key, click or mouse movement clears it.
 */
export function PauseInfo({ item }: { item: BaseItem }) {
  const episode = item.Type === "Episode";
  // An episode lists its guest stars; the regular cast is on the series.
  const series = useQuery({
    queryKey: ["item", item.SeriesId, "pause-info"],
    queryFn: () => getItem(item.SeriesId!, ["People", "Overview", "OfficialRating", "Genres"]),
    enabled: episode && Boolean(item.SeriesId),
    staleTime: 10 * 60_000,
  });
  const filler = useFillerIds(episode ? item.SeriesId : undefined).has(item.Id);
  const title = useEpisodeTitle(item);
  const logo = logoImage(item, 600);
  const people = [...(item.People ?? []), ...(series.data?.People ?? [])];
  const cast = [...new Set(people.filter((p) => p.Type === "Actor" || p.Type === "GuestStar").map((p) => p.Name))].slice(0, 5);
  const director = people.find((p) => p.Type === "Director")?.Name;
  const overview = item.Overview || series.data?.Overview;
  const meta = joinDots([
    !episode && yearOf(item),
    item.OfficialRating ?? series.data?.OfficialRating,
    formatRuntime(item.RunTimeTicks),
    typeof item.CommunityRating === "number" && `★ ${item.CommunityRating.toFixed(1)}`,
    (item.Genres?.length ? item.Genres : series.data?.Genres)?.slice(0, 3).join(", "),
  ]);

  return (
    <div className="pause-info fade-in" aria-live="polite">
      <div className="pause-info__body">
        <span className="eyebrow">You're watching</span>
        {logo ? <img className="pause-info__logo" src={logo.url} alt={episode ? item.SeriesName : item.Name} /> : <h2 className="pause-info__title">{episode ? item.SeriesName : item.Name}</h2>}
        {episode && (
          <p className="pause-info__episode">
            {episodeCode(item)}
            {filler ? <FillerBadge /> : " · "}
            {title}
          </p>
        )}
        {meta && <p className="pause-info__meta">{meta}</p>}
        {overview && <p className="pause-info__overview">{overview}</p>}
        {cast.length > 0 && (
          <p className="pause-info__people">
            <span>Starring</span> {cast.join(", ")}
          </p>
        )}
        {director && !episode && (
          <p className="pause-info__people">
            <span>Director</span> {director}
          </p>
        )}
      </div>
      <span className="pause-info__paused">Paused</span>
    </div>
  );
}
