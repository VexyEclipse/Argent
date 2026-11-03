import { memo, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { BaseItem } from "@/api/types";
import { landscapeImage, posterImage } from "@/api/images";
import { cardSubtitle, progressOf } from "@/api/format";
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
  eager?: boolean;
  /** Your own 1–10 score, shown as a corner badge. */
  rating?: number;
}

export function detailsPath(item: Pick<BaseItem, "Id" | "Type">): string {
  if (item.Type === "Person") return `/person/${item.Id}`;
  if (item.Type === "Genre") return `/genre/${item.Id}`;
  return `/details/${item.Id}`;
}

export const MediaCard = memo(function MediaCard({ item, variant = "poster", subtitle, caption, showProgress = true, playOnClick, onDismiss, eager, rating }: Props) {
  const navigate = useNavigate();
  const image = variant === "poster" ? posterImage(item, 360) : landscapeImage(item, 640);
  const progress = showProgress ? progressOf(item) : 0;
  const played = item.UserData?.Played;
  const unplayed = item.Type === "Series" ? item.UserData?.UnplayedItemCount : undefined;
  const title = item.Type === "Episode" && variant === "landscape" ? item.Name : item.SeriesName && variant === "poster" ? item.SeriesName : item.Name;
  const sub = subtitle ?? (item.Type === "Episode" && variant === "poster" ? item.Name : cardSubtitle(item));
  const to = playOnClick ? `/play/${item.Id}` : detailsPath(item);
  // Series and collections resolve to the right episode or film in the player.
  const playable = item.Type !== "Person" && item.Type !== "Genre";

  const dismiss = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDismiss?.(item);
  };

  const play = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(`/play/${item.Id}`);
  };

  return (
    <div className={`card card--${variant}`}>
      <Link to={to} className="card__link" title={item.Name}>
        <div className="card__media">
          <Artwork image={image} alt="" fallbackLabel={item.Name} eager={eager} />
          <div className="card__veil" />
          {played && (
            <span className="card__badge card__badge--played" aria-label="Watched">
              <Icon name="check" size={14} />
            </span>
          )}
          {!played && unplayed ? <span className="card__badge">{unplayed}</span> : null}
          {rating ? (
            <span className="card__badge card__badge--rating" aria-label={`Your rating ${rating} out of 10`}>
              <Icon name="star" size={11} /> {rating}
            </span>
          ) : null}
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
        {onDismiss && (
          <button className="card__dismiss" onClick={dismiss} aria-label={`Not interested in ${item.Name}`} title="Not interested">
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
