import { memo, useSyncExternalStore, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { BaseItem } from "@/api/types";
import { landscapeImage, posterImage } from "@/api/images";
import { hasCopies, subscribeCopies, unwatchedCount } from "@/api/duplicates";
import { cardSubtitle, progressOf } from "@/api/format";
import { getEpisodes } from "@/api/jellyfin";
import { useAuth } from "@/auth/AuthProvider";
import { openMenu, toggleSelected, useIsSelected, useSelecting } from "@/features/manage/store";
import { usePosterScore } from "@/features/ratings/prefs";
import { canWatchlist, useWatchlistToggle } from "@/features/watchlist/store";
import { useNewBadge } from "@/features/upcoming/newBadges";
import { useReminder } from "@/features/upcoming/reminders";
import { Artwork } from "./Artwork";
import { Icon } from "./Icon";

export type CardVariant = "poster" | "landscape";

interface Props {
  item: BaseItem;
  variant?: CardVariant;
  /** Overrides the default subtitle (year / series · episode). */
  subtitle?: string;
  /** Small explanatory caption, e.g. why something was recommended. */
  caption?: string;
  showProgress?: boolean;
  /** Clicking the card starts playback (Continue Watching, Next Up). */
  playOnClick?: boolean;
  onDismiss?: (item: BaseItem) => void;
  /** What the dismiss button does, for its label ("Not interested" by default). */
  dismissLabel?: string;
  eager?: boolean;
  /** Your own 1–10 score, shown as a corner badge. */
  rating?: number;
  /** No play button (the card is about something that hasn't aired yet). */
  noPlay?: boolean;
  /** A "Remind me" bell (Coming Up). */
  remind?: boolean;
}

/**
 * A show's unwatched episodes. Jellyfin counts every copy of an episode, so for a show
 * known to have copies the count comes from its merged episode list (the one the show's
 * page uses); for any other show, Jellyfin's own number.
 */
function useUnwatched(item: BaseItem): number | undefined {
  const series = item.Type === "Series";
  const copies = useSyncExternalStore(subscribeCopies, () => series && hasCopies(item.Id));
  const episodes = useQuery({
    queryKey: ["episodes", item.Id, "all"],
    queryFn: () => getEpisodes(item.Id).then((r) => r.Items),
    enabled: copies,
    staleTime: 60_000,
  });
  if (!series) return undefined;
  return copies && episodes.data ? unwatchedCount(episodes.data) : item.UserData?.UnplayedItemCount;
}

export function detailsPath(item: Pick<BaseItem, "Id" | "Type">): string {
  if (item.Type === "Person") return `/person/${item.Id}`;
  if (item.Type === "Genre") return `/genre/${item.Id}`;
  return `/details/${item.Id}`;
}

export const MediaCard = memo(function MediaCard({
  item,
  variant = "poster",
  subtitle,
  caption,
  showProgress = true,
  playOnClick,
  onDismiss,
  dismissLabel = "Not interested",
  eager,
  rating,
  noPlay,
  remind,
}: Props) {
  const navigate = useNavigate();
  const myScore = usePosterScore(item.Id);
  const watchlist = useWatchlistToggle(item);
  const score = rating ?? myScore;
  const fresh = useNewBadge(item.Type === "Series" ? item.Id : "");
  // An upcoming episode's reminder is for its show.
  const reminder = useReminder(
    !remind ? undefined : item.Type === "Episode" && item.SeriesId ? { Id: item.SeriesId, Name: item.SeriesName ?? item.Name, Type: "Series" } : item,
  );
  const image = variant === "poster" ? posterImage(item, 360) : landscapeImage(item, 640);
  const progress = showProgress ? progressOf(item) : 0;
  const played = item.UserData?.Played;
  const unplayed = useUnwatched(item);
  const title = item.Type === "Episode" && variant === "landscape" ? item.Name : item.SeriesName && variant === "poster" ? item.SeriesName : item.Name;
  const sub = subtitle ?? (item.Type === "Episode" && variant === "poster" ? item.Name : cardSubtitle(item));
  const to = playOnClick ? `/play/${item.Id}` : detailsPath(item);
  // Series and collections resolve to the right episode or film in the player.
  // Virtual items (upcoming or missing episodes) have nothing to play yet.
  const playable = !noPlay && item.Type !== "Person" && item.Type !== "Genre" && item.LocationType !== "Virtual";
  // Administrators: right-click for the management menu, and multi-select.
  const { isAdmin } = useAuth();
  const manageable = isAdmin && item.Type !== "Person" && item.Type !== "Genre" && item.LocationType !== "Virtual";
  const selecting = useSelecting() && manageable;
  const selected = useIsSelected(item.Id);

  const onContextMenu = (event: MouseEvent) => {
    if (!manageable) return;
    event.preventDefault();
    if (selecting) toggleSelected(item);
    else openMenu(item, { x: event.clientX, y: event.clientY });
  };

  // While selecting, a click picks the card instead of opening it.
  const onClickCapture = (event: MouseEvent) => {
    if (!selecting) return;
    event.preventDefault();
    event.stopPropagation();
    toggleSelected(item);
  };

  const dismiss = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDismiss?.(item);
  };

  const toggleReminder = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    reminder.toggle();
  };

  const toggleWatchlist = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    watchlist.toggle();
  };

  const play = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/play/${item.Id}`);
  };

  return (
    <div
      className={`card card--${variant} ${selecting ? "is-selectable" : ""} ${selecting && selected ? "is-selected" : ""}`}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
    >
      <Link to={to} className="card__link" title={item.Name} aria-pressed={selecting ? selected : undefined}>
        <div className="card__media">
          {selecting && (
            <span className="card__select" aria-hidden="true">
              <Icon name="check" size={15} />
            </span>
          )}
          <Artwork image={image} alt="" fallbackLabel={item.Name} eager={eager} />
          <div className="card__veil" />
          {played && (
            <span className="card__badge card__badge--played" aria-label="Watched">
              <Icon name="check" size={14} />
            </span>
          )}
          {!played && unplayed ? <span className="card__badge">{unplayed}</span> : null}
          {score ? (
            <span className="card__badge card__badge--rating" aria-label={`Your rating ${score} out of 10`}>
              <Icon name="star" size={11} /> {score}
            </span>
          ) : null}
          {fresh && <span className="card__new">{fresh}</span>}
          {progress > 0 && progress < 100 && (
            <span className="card__progress" aria-label={`${Math.round(progress)}% watched`}>
              <span style={{ width: `${progress}%` }} />
            </span>
          )}
        </div>
        <div className="card__text">
          <span className="card__title">{title}</span>
          {sub && <span className="card__sub">{sub}</span>}
          {caption && <span className="card__caption">{caption}</span>}
        </div>
      </Link>
      {/* Buttons sit over the artwork but outside the link (no buttons inside anchors). */}
      <div className="card__overlay">
        {playable && (
          <button className="card__play" onClick={play} aria-label={`Play ${item.Name}`} title="Play" tabIndex={-1}>
            <Icon name="play" size={18} />
          </button>
        )}
        {remind && (
          <button
            className={`card__remind ${reminder.on ? "is-on" : ""}`}
            onClick={toggleReminder}
            aria-label={reminder.on ? `Turn off the reminder for ${item.Name}` : `Remind me about ${item.Name}`}
            aria-pressed={reminder.on}
            title={reminder.on ? "Reminder on" : "Remind me"}
          >
            <Icon name={reminder.on ? "bellFilled" : "bell"} size={15} />
          </button>
        )}
        {canWatchlist(item) && (
          <button
            className={`card__watch ${watchlist.on ? "is-on" : ""}`}
            onClick={toggleWatchlist}
            aria-label={watchlist.on ? `Remove ${item.Name} from watchlist` : `Add ${item.Name} to watchlist`}
            title={watchlist.on ? "On your watchlist" : "Add to watchlist"}
            tabIndex={-1}
          >
            <Icon name={watchlist.on ? "bookmarkFilled" : "bookmark"} size={watchlist.on ? 15 : 16} />
          </button>
        )}
        {onDismiss && (
          <button className="card__dismiss" onClick={dismiss} aria-label={`${dismissLabel}: ${item.Name}`} title={dismissLabel}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

export function CardSkeleton({ variant = "poster" }: { variant?: CardVariant }) {
  return (
    <div className={`card card--${variant} card--skeleton`} aria-hidden="true">
      <div className="card__media skeleton" />
      <div className="card__text">
        <span className="skeleton" style={{ height: 12, width: "70%" }} />
        <span className="skeleton" style={{ height: 10, width: "40%", marginTop: 6 }} />
      </div>
    </div>
  );
}
