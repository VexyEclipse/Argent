import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { BaseItem, MediaStream } from "@/api/types";
import { backdropImage, logoImage, posterImage } from "@/api/images";
import { endsAt, formatClock, formatRuntime, progressOf, seasonCountLabel, yearRange, TICKS_PER_SECOND } from "@/api/format";
import { Artwork } from "@/components/Artwork";
import { blurHashToDataUrl } from "@/components/blurhash";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/auth/AuthProvider";
import { openMenu } from "@/features/manage/store";
import { useRatings } from "@/features/ratings/prefs";
import { useRateDialog } from "@/features/ratings/RatePrompt";
import { canWatchlist, useWatchlistToggle } from "@/features/watchlist/store";
import { TrailerModal, useTrailer } from "./Trailer";
import { useItemActions } from "./useItemActions";

function videoBadge(streams: MediaStream[] = []): string[] {
  const badges: string[] = [];
  const video = streams.find((s) => s.Type === "Video");
  if (video?.Width) {
    if (video.Width >= 3800) badges.push("4K");
    else if (video.Width >= 1900) badges.push("HD");
    else badges.push("SD");
  }
  if (video?.VideoRangeType && !/SDR/i.test(video.VideoRangeType)) badges.push(/DOVI/i.test(video.VideoRangeType) ? "Dolby Vision" : "HDR");
  const audio = streams.filter((s) => s.Type === "Audio");
  if (audio.some((a) => /atmos/i.test(a.DisplayTitle ?? ""))) badges.push("Atmos");
  else if (audio.some((a) => (a.Channels ?? 0) >= 6)) badges.push(audio.some((a) => (a.Channels ?? 0) >= 8) ? "7.1" : "5.1");
  if (streams.some((s) => s.Type === "Subtitle")) badges.push("CC");
  return badges;
}

interface HeroProps {
  item: BaseItem;
  /** Item to play when the primary button is pressed (series → next episode). */
  playTarget?: BaseItem | null;
  playLabel?: string;
  eyebrow?: ReactNode;
  showPoster?: boolean;
  extraActions?: ReactNode;
  children?: ReactNode;
}

export function Hero({ item, playTarget, playLabel, eyebrow, showPoster = true, extraActions, children }: HeroProps) {
  const navigate = useNavigate();
  const actions = useItemActions(item);
  const watchlist = useWatchlistToggle(item);
  const { isAdmin } = useAuth();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const trailer = useTrailer(item);
  const ratings = useRatings();
  const rateDialog = useRateDialog();
  const rateable = item.Type === "Movie" || item.Type === "Series";
  const mine = rateable ? ratings.ratings[item.Id] : undefined;
  const backdrop = backdropImage(item, 1920);
  const logo = logoImage(item, 700);
  const poster = posterImage(item, 400);
  const target = playTarget === undefined ? item : playTarget;
  const progress = target ? progressOf(target) : 0;
  const resumeTicks = target?.UserData?.PlaybackPositionTicks ?? 0;
  const canResume = progress > 0 && progress < 98;
  const placeholder = blurHashToDataUrl(backdrop?.blurHash);
  const streams = item.MediaSources?.[0]?.MediaStreams ?? item.MediaStreams;

  const meta: ReactNode[] = [];
  const years = yearRange(item);
  if (years) meta.push(years);
  if (item.OfficialRating) meta.push(<span className="cert">{item.OfficialRating}</span>);
  if (item.Type === "Series" && item.ChildCount) meta.push(seasonCountLabel(item.ChildCount));
  else if (item.RunTimeTicks) meta.push(formatRuntime(item.RunTimeTicks));
  if (typeof item.CommunityRating === "number")
    meta.push(
      <span className="hero__rating">
        <Icon name="star" size={13} /> {item.CommunityRating.toFixed(1)}
      </span>,
    );
  if (mine)
    meta.push(
      <span className="hero__rating hero__rating--mine" title="Your rating">
        <Icon name="star" size={13} /> {mine.stars}/10 yours
      </span>,
    );
  if (typeof item.CriticRating === "number") meta.push(<span className="hero__rating">{item.CriticRating}% critics</span>);
  if (item.RunTimeTicks && item.Type !== "Series") meta.push(`Ends at ${endsAt(item.RunTimeTicks, canResume ? resumeTicks : 0)}`);

  const badges = videoBadge(streams);

  return (
    <section
      className="hero"
      onContextMenu={
        isAdmin
          ? (e) => {
              // Right-clicking the page header manages the title itself.
              if ((e.target as HTMLElement).closest("a, input, textarea")) return;
              e.preventDefault();
              openMenu(item, { x: e.clientX, y: e.clientY });
            }
          : undefined
      }
    >
      <div className="hero__backdrop" style={placeholder ? { backgroundImage: `url("${placeholder}")` } : undefined}>
        {backdrop && <img src={backdrop.url} alt="" />}
      </div>
      <div className="hero__shade" />
      <div className="hero__inner">
        {showPoster && poster && (
          <div className="hero__poster">
            <Artwork image={poster} alt={`${item.Name} poster`} eager />
          </div>
        )}
        <div className="hero__content">
          {eyebrow && <div className="hero__eyebrow eyebrow">{eyebrow}</div>}
          {logo && item.Type !== "Episode" ? (
            <h1 className="hero__logo">
              <img src={logo.url} alt={item.Name} />
            </h1>
          ) : (
            <h1 className="hero__title">{item.Name}</h1>
          )}
          {item.OriginalTitle && item.OriginalTitle !== item.Name && <div className="hero__original">{item.OriginalTitle}</div>}
          <div className="hero__meta">
            {meta.map((m, i) => (
              <span className="hero__meta-item" key={i}>
                {m}
              </span>
            ))}
            {badges.map((b) => (
              <span key={b} className="badge">
                {b}
              </span>
            ))}
          </div>
          {item.Genres?.length ? <div className="hero__genres">{item.Genres.join("  ·  ")}</div> : null}
          {item.Taglines?.[0] && <p className="hero__tagline">{item.Taglines[0]}</p>}
          {item.Overview && <p className="hero__overview">{item.Overview}</p>}

          <div className="hero__actions">
            {target && (
              <Button variant="primary" size="lg" icon="play" onClick={() => navigate(`/play/${target.Id}${canResume ? "" : "?start=0"}`)} data-autofocus>
                {playLabel ?? (canResume ? `Resume ${formatClock(resumeTicks / TICKS_PER_SECOND)}` : "Play")}
              </Button>
            )}
            {target && canResume && (
              <Button variant="secondary" size="lg" onClick={() => navigate(`/play/${target.Id}?start=0`)}>
                From start
              </Button>
            )}
            {trailer && (
              <Button variant="secondary" size="lg" icon="film" onClick={() => setTrailerOpen(true)}>
                Trailer
              </Button>
            )}
            <Button
              variant="icon"
              size="lg"
              icon={actions.isPlayed ? "check" : "eye"}
              active={actions.isPlayed}
              onClick={actions.togglePlayed}
              aria-label={actions.isPlayed ? "Mark unwatched" : "Mark watched"}
              title={actions.isPlayed ? "Watched" : "Mark watched"}
            />
            {canWatchlist(item) && (
              <Button
                variant="icon"
                size="lg"
                icon={watchlist.on ? "bookmarkFilled" : "bookmark"}
                active={watchlist.on}
                onClick={watchlist.toggle}
                aria-label={watchlist.on ? "Remove from watchlist" : "Add to watchlist"}
                title={watchlist.on ? "On your watchlist" : "Add to watchlist"}
              />
            )}
            <Button
              variant="icon"
              size="lg"
              icon={actions.isFavorite ? "heartFilled" : "heart"}
              active={actions.isFavorite}
              onClick={actions.toggleFavorite}
              aria-label={actions.isFavorite ? "Remove from favourites" : "Add to favourites"}
              title="Favourite"
            />
            {rateable && (
              <Button
                variant="icon"
                size="lg"
                icon="star"
                active={Boolean(mine)}
                onClick={() => rateDialog.open({ id: item.Id, name: item.Name, type: item.Type === "Series" ? "Series" : "Movie" })}
                aria-label={mine ? `Your rating: ${mine.stars} out of 10. Change it` : "Rate"}
                title={mine ? `Your rating: ${mine.stars}/10` : "Rate"}
              />
            )}
            {extraActions}
            {isAdmin && (
              <Button
                variant="icon"
                size="lg"
                icon="more"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu(item, { x: r.left, y: r.bottom + 8 }, true);
                }}
                aria-label="More actions"
                aria-haspopup="menu"
                title="More"
              />
            )}
          </div>
          {canResume && (
            <div className="hero__progress" aria-label={`${Math.round(progress)}% watched`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
          {children}
        </div>
      </div>
      {trailerOpen && trailer && <TrailerModal trailer={trailer} title={item.Name} onClose={() => setTrailerOpen(false)} />}
      {rateDialog.dialog}
    </section>
  );
}
