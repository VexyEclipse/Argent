import { memo, useRef, useSyncExternalStore, type MouseEvent, type TouchEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { BaseItem } from "@/api/types";
import { landscapeImage, posterImage } from "@/api/images";
import { hasCopies, inLibraryPath, subscribeCopies, unwatchedCount } from "@/api/duplicates";
import { cardSubtitle, progressOf } from "@/api/format";
import { getEpisodes, getLibraryRoots } from "@/api/jellyfin";
import { useAuth } from "@/auth/AuthProvider";
import { openMenu, toggleSelected, useIsSelected, useSelecting } from "@/features/manage/store";
import { usePosterScore } from "@/features/ratings/prefs";
import { canWatchlist, useWatchlistToggle } from "@/features/watchlist/store";
import { useNewBadge } from "@/features/upcoming/newBadges";
import { useReminder } from "@/features/upcoming/reminders";
import { hoverEnter, hoverLeave, openSheet, setSpotlight, usePreviewPrefs } from "@/features/previews/store";
import { usePlatform } from "@/platform/platform";
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
  /** No preview on hover, focus or hold (Continue Watching, Next Up: you know what these are). */
  noPreview?: boolean;
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

/**
 * The copy of an episode that the show's episode list shows. Jellyfin's own rows (Next Up,
 * Continue Watching, Recently Added) can hand over a copy left behind by a removed folder,
 * whose picture is gone; for an episode like that, or one of a show known to have copies,
 * the card shows the copy in the library instead.
 */
function useShownCopy(item: BaseItem): BaseItem {
  const episode = item.Type === "Episode" && Boolean(item.SeriesId);
  const known = useSyncExternalStore(subscribeCopies, () => episode && hasCopies(item.SeriesId!));
  const roots = useQuery({ queryKey: ["library-roots"], queryFn: getLibraryRoots, enabled: episode && Boolean(item.Path), staleTime: Infinity });
  const leftOver = episode && inLibraryPath(item.Path, roots.data ?? null) === false;
  const list = useQuery({
    queryKey: ["episodes", item.SeriesId, "all"],
    queryFn: () => getEpisodes(item.SeriesId!).then((r) => r.Items),
    enabled: known || leftOver,
    staleTime: 60_000,
  });
  if (!list.data) return item;
  return list.data.find((e) => e.Id === item.Id || e.Copies?.some((c) => c.Id === item.Id)) ?? item;
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
  noPreview,
}: Props) {
  const navigate = useNavigate();
  // What the card shows and opens; `item` stays what the row was given (for dismissing it).
  const shown = useShownCopy(item);
  const myScore = usePosterScore(item.Id);
  const watchlist = useWatchlistToggle(item);
  const score = rating ?? myScore;
  const fresh = useNewBadge(item.Type === "Series" ? item.Id : "");
  // An upcoming episode's reminder is for its show.
  const reminder = useReminder(
    !remind ? undefined : item.Type === "Episode" && item.SeriesId ? { Id: item.SeriesId, Name: item.SeriesName ?? item.Name, Type: "Series" } : item,
  );
  const image = variant === "poster" ? posterImage(shown, 360) : landscapeImage(shown, 640);
  const progress = showProgress ? progressOf(shown) : 0;
  const played = shown.UserData?.Played;
  const unplayed = useUnwatched(item);
  const title = shown.Type === "Episode" && variant === "landscape" ? shown.Name : shown.SeriesName && variant === "poster" ? shown.SeriesName : shown.Name;
  const sub = subtitle ?? (shown.Type === "Episode" && variant === "poster" ? shown.Name : cardSubtitle(shown));
  const to = playOnClick ? `/play/${shown.Id}` : detailsPath(shown);
  // Series and collections resolve to the right episode or film in the player.
  // Virtual items (upcoming or missing episodes) have nothing to play yet.
  const playable = !noPlay && item.Type !== "Person" && item.Type !== "Genre" && item.LocationType !== "Virtual";
  // Administrators: right-click for the management menu, and multi-select.
  const { isAdmin } = useAuth();
  const manageable = isAdmin && item.Type !== "Person" && item.Type !== "Genre" && item.LocationType !== "Virtual";
  const selecting = useSelecting() && manageable;
  const selected = useIsSelected(item.Id);

  // Previews: hover on a desktop, focus on a TV (home only), press and hold on a phone.
  const platform = usePlatform();
  const previews = usePreviewPrefs().enabled && !noPreview && item.Type !== "Person" && item.Type !== "Genre" && !selecting;
  const cardRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean }>({ timer: 0, x: 0, y: 0, fired: false });

  const onMouseEnter = () => {
    if (!previews || platform !== "desktop" || !cardRef.current || !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    hoverEnter({ item: shown, anchor: cardRef.current, variant, remind, noPlay });
  };
  const onMouseLeave = () => {
    if (platform === "desktop") hoverLeave();
  };
  const onFocus = () => {
    if (platform !== "tv" || !cardRef.current?.closest(".home__rows")) return;
    // A card without a preview takes the spotlight down rather than leaving the last one up.
    setSpotlight(previews ? shown : null);
  };
  const onTouchStart = (event: TouchEvent) => {
    if (!previews || platform !== "mobile") return;
    const t = event.touches[0];
    window.clearTimeout(press.current.timer);
    press.current = {
      x: t.clientX,
      y: t.clientY,
      fired: false,
      timer: window.setTimeout(() => {
        press.current.fired = true;
        navigator.vibrate?.(8);
        openSheet(shown);
      }, 450),
    };
  };
  const onTouchMove = (event: TouchEvent) => {
    const t = event.touches[0];
    if (Math.hypot(t.clientX - press.current.x, t.clientY - press.current.y) > 10) window.clearTimeout(press.current.timer);
  };
  const endPress = () => window.clearTimeout(press.current.timer);

  const onContextMenu = (event: MouseEvent) => {
    // On a phone, holding a card opens its preview (which has the management menu too).
    if (platform === "mobile" && previews) {
      event.preventDefault();
      return;
    }
    if (!manageable) return;
    event.preventDefault();
    if (selecting) toggleSelected(item);
    else openMenu(item, { x: event.clientX, y: event.clientY });
  };

  // While selecting, a click picks the card instead of opening it. After a press that
  // opened a preview, the lift isn't a click.
  const onClickCapture = (event: MouseEvent) => {
    if (press.current.fired) {
      press.current.fired = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
    navigate(`/play/${shown.Id}`);
  };

  return (
    <div
      ref={cardRef}
      className={`card card--${variant} ${previews && platform === "desktop" ? "has-preview" : ""} ${selecting ? "is-selectable" : ""} ${selecting && selected ? "is-selected" : ""}`}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
    >
      <Link to={to} className="card__link" title={previews && platform === "desktop" ? undefined : item.Name} aria-pressed={selecting ? selected : undefined}>
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
