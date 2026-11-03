import { forwardRef, type CSSProperties, type ReactNode } from "react";
import type { BaseItem } from "@/api/types";
import { backdropImage, logoImage, posterImage } from "@/api/images";
import { endsAt, formatRuntime, seasonCountLabel, yearOf } from "@/api/format";
import { blurHashToDataUrl } from "@/components/blurhash";
import { Icon } from "@/components/Icon";
import type { MediaBarConfig } from "./config";
import { plateColours, truncatePlot } from "./logic";

interface SlideProps {
  item: BaseItem;
  config: MediaBarConfig;
  active: boolean;
  position: number;
  total: number;
  listTitle?: string;
  withVideo: boolean;
  hasTrailer: boolean;
  favorite: boolean;
  progressKey: string;
  progressRunning: boolean;
  onPlay: () => void;
  onDetails: () => void;
  onFavorite: () => void;
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Critic score glyph. Monochrome by default; the plugin's custom SVGs win if set. */
function CriticIcon({ score, config }: { score: number; config: MediaBarConfig }) {
  const custom = score < 60 ? config.imageSvgs.rottenTomato : config.imageSvgs.freshTomato;
  if (custom) return <img className="mb-critic-icon" src={svgDataUrl(custom)} alt="" />;
  return (
    <svg className="mb-critic-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      {score < 60 ? (
        <path
          d="M12 3l1.6 4.2 4.2-2.3-1.6 4.4 4.6.9-3.8 2.6 3.2 3.4-4.6-.4.2 4.6-3.8-2.7L12 21l-1.6-4.3-3.8 2.7.2-4.6-4.6.4 3.2-3.4-3.8-2.6 4.6-.9-1.6-4.4 4.2 2.3z"
          fill="currentColor"
          opacity=".8"
        />
      ) : (
        <>
          <circle cx="12" cy="13.5" r="8" fill="currentColor" />
          <path d="M8.5 5.2c1.6.2 2.8 1 3.5 2.1.7-1.1 1.9-1.9 3.5-2.1-1 1.9-2 2.7-3.5 3-1.5-.3-2.5-1.1-3.5-3z" fill="var(--bg-0)" />
        </>
      )}
    </svg>
  );
}

function SpecLine({ item, config }: { item: BaseItem; config: MediaBarConfig }) {
  const year = yearOf(item);
  const parts: ReactNode[] = [];
  if (year) parts.push(<span key="y">{year}</span>);
  if (typeof item.CommunityRating === "number")
    parts.push(
      <span key="r" className="mb-spec__rating">
        <Icon name="star" size={13} />
        {item.CommunityRating.toFixed(1)}
      </span>,
    );
  if (typeof item.CriticRating === "number")
    parts.push(
      <span key="c" className="mb-spec__rating">
        <CriticIcon score={item.CriticRating} config={config} />
        {item.CriticRating.toFixed(0)}%
      </span>,
    );
  if (item.ChildCount) parts.push(<span key="s">{seasonCountLabel(item.ChildCount)}</span>);
  else if (item.RunTimeTicks) parts.push(<span key="t">{formatRuntime(item.RunTimeTicks)}</span>);
  return (
    <div className="mb-spec">
      {parts.map((p, i) => (
        <span className="mb-spec__item" key={i}>
          {p}
        </span>
      ))}
      {item.OfficialRating && <span className="mb-cert">{item.OfficialRating}</span>}
    </div>
  );
}

function ClassicInfo({ item, config }: { item: BaseItem; config: MediaBarConfig }) {
  const fields: ReactNode[] = [];
  if (typeof item.CommunityRating === "number")
    fields.push(
      <span className="mb-spec__rating" key="r">
        <Icon name="star" size={13} />
        {item.CommunityRating.toFixed(1)}
      </span>,
    );
  if (typeof item.CriticRating === "number")
    fields.push(
      <span className="mb-spec__rating" key="c">
        <CriticIcon score={item.CriticRating} config={config} />
        {item.CriticRating.toFixed(0)}%
      </span>,
    );
  const year = yearOf(item);
  if (year) fields.push(<span key="y">{year}</span>);
  if (item.OfficialRating)
    fields.push(
      <span className="mb-cert" key="a" aria-label={`Content rated ${item.OfficialRating}`}>
        {item.OfficialRating}
      </span>,
    );
  if (item.ChildCount) fields.push(<span key="s">{seasonCountLabel(item.ChildCount)}</span>);
  else if (item.RunTimeTicks) fields.push(<span key="e">Ends at {endsAt(item.RunTimeTicks)}</span>);
  return (
    <div className="mb-spec">
      {fields.map((f, i) => (
        <span className="mb-spec__item" key={i}>
          {f}
        </span>
      ))}
    </div>
  );
}

function SpecTable({ item, rows: maxRows }: { item: BaseItem; rows: number }) {
  const rows: [string, string][] = [];
  const add = (label: string, value?: string | null) => value && rows.push([label, value]);
  if (typeof item.CommunityRating === "number") add("Rating", item.CommunityRating.toFixed(1));
  if (typeof item.CriticRating === "number") add("Critics", `${item.CriticRating.toFixed(0)}%`);
  const year = yearOf(item);
  if (year) add("Year", String(year));
  if (item.ChildCount) add(item.ChildCount <= 1 ? "Season" : "Seasons", String(item.ChildCount));
  else if (item.RunTimeTicks) add("Runtime", formatRuntime(item.RunTimeTicks));
  if (item.Genres?.length) add("Genre", item.Genres.slice(0, 2).join(", "));
  if (item.OfficialRating) add("Rated", item.OfficialRating);
  const shown = rows.slice(0, maxRows);
  return (
    <dl className="mb-plate-specs">
      {shown.map(([label, value]) => (
        <div className="mb-plate-specs__row" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const Slide = forwardRef<HTMLDivElement, SlideProps>(function Slide(
  { item, config, active, position, total, listTitle, withVideo, hasTrailer, favorite, progressKey, progressRunning, onPlay, onDetails, onFavorite },
  trailerHostRef,
) {
  const backdrop = backdropImage(item, 1920);
  const logo = logoImage(item, 800);
  const poster = posterImage(item, 400);
  const placeholder = config.useBlurHashPlaceholder ? blurHashToDataUrl(backdrop?.blurHash) : undefined;
  const tagline = item.Taglines?.[0];
  const plot = truncatePlot(item.Overview, config.maxPlotLength);
  const layout = config.layout;

  const style: CSSProperties & Record<string, string> = {};
  if (layout === "plate") {
    const colours = plateColours(backdrop?.blurHash, config.plateLuminance, config.plateAccentLuminance);
    style["--plate"] = colours?.plate ?? config.plateFallback;
    style["--plate-accent"] = colours?.accent ?? config.plateAccentFallback;
  }

  const titleBlock = (
    <div className="mb-logo">{logo ? <img src={logo.url} alt={item.Name} draggable={false} /> : <h2 className="mb-title">{item.Name}</h2>}</div>
  );

  const buttons = (
    <div className="mb-actions">
      <button className="btn btn--primary btn--lg mb-play" onClick={onPlay} tabIndex={active ? 0 : -1} data-autofocus={active || undefined}>
        <Icon name="play" size={20} />
        <span>Play</span>
      </button>
      <button className="btn btn--secondary btn--lg" onClick={onDetails} tabIndex={active ? 0 : -1}>
        <Icon name="info" size={20} />
        <span>Details</span>
      </button>
      <button
        className={`btn btn--icon btn--lg ${favorite ? "is-active" : ""}`}
        onClick={onFavorite}
        tabIndex={active ? 0 : -1}
        aria-pressed={favorite}
        aria-label={favorite ? "Remove from favourites" : "Add to favourites"}
        title="Favourite"
      >
        <Icon name={favorite ? "heartFilled" : "heart"} size={20} />
      </button>
    </div>
  );

  let content: ReactNode;
  if (layout === "plate") {
    content = (
      <>
        <div className="mb-eyebrow eyebrow">
          {listTitle || "Featured"} · {String(position + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>
        {titleBlock}
        <p className={`mb-plot ${withVideo ? "with-video" : ""}`}>{plot}</p>
        <SpecTable item={item} rows={config.plateSpecRows} />
        {buttons}
      </>
    );
  } else if (layout === "classic") {
    content = (
      <>
        {titleBlock}
        <ClassicInfo item={item} config={config} />
        {item.Genres?.length ? <div className="mb-genres">{item.Genres.slice(0, 4).join("  ·  ")}</div> : null}
        <p className={`mb-plot ${withVideo ? "with-video" : ""}`}>{plot}</p>
        {buttons}
      </>
    );
  } else {
    content = (
      <>
        {listTitle && <div className="mb-eyebrow eyebrow">{listTitle}</div>}
        {titleBlock}
        {tagline && <div className="mb-tagline">{tagline}</div>}
        <div className="mb-rail" aria-hidden="true">
          <span
            key={progressKey}
            className="mb-rail__progress"
            style={{ animationDuration: `${config.shuffleInterval}ms`, animationPlayState: progressRunning ? "running" : "paused" }}
          />
        </div>
        <SpecLine item={item} config={config} />
        <p className={`mb-plot ${withVideo ? "with-video" : ""}`}>{plot}</p>
        {buttons}
      </>
    );
  }

  return (
    <div
      className={`mb-slide ${active ? "is-active" : ""} ${config.slideAnimationEnabled ? "is-animated" : ""}`}
      style={style}
      aria-hidden={!active}
      inert={!active || undefined}
      data-item-id={item.Id}
    >
      <div className="mb-backdrop">
        {backdrop && (
          <img
            className={`mb-backdrop__img ${withVideo ? "with-video" : ""}`}
            src={backdrop.url}
            alt=""
            draggable={false}
            style={placeholder ? { backgroundImage: `url("${placeholder}")` } : undefined}
            fetchPriority={active ? "high" : "low"}
          />
        )}
      </div>
      {hasTrailer && <div className={`mb-trailer ${withVideo ? "is-visible" : ""}`} ref={trailerHostRef} />}
      {layout === "plate" && <div className="mb-plate" />}
      <div className="mb-shade" />
      <div className="mb-content">
        {layout === "marquee" && poster && (
          <div className="mb-poster">
            <img src={poster.url} alt="" draggable={false} />
          </div>
        )}
        <div className="mb-content__main">{content}</div>
      </div>
    </div>
  );
});
