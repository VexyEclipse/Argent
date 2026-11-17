import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { logoImage } from "@/api/images";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { detailsPath } from "@/components/MediaCard";
import { openMenu } from "@/features/manage/store";
import { canWatchlist, useWatchlistToggle } from "@/features/watchlist/store";
import { usePlatform } from "@/platform/platform";
import { hasPreviewTrailer, PreviewMedia, PreviewMeta, usePreviewDetails } from "./PreviewMedia";
import { closeHover, closeSheet, hoverHold, hoverLeave, setSpotlight, usePreviewPrefs, usePreviewState, useSpotlightFocus, type HoverTarget } from "./store";
import "./previews.css";

const playable = (item: BaseItem) => item.Type !== "Person" && item.Type !== "Genre" && item.LocationType !== "Virtual";
const headline = (item: BaseItem) => (item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name);

function WatchlistButton({ item, className }: { item: BaseItem; className: string }) {
  const watchlist = useWatchlistToggle(item);
  if (!canWatchlist(item)) return null;
  return (
    <button
      className={`${className} ${watchlist.on ? "is-on" : ""}`}
      onClick={watchlist.toggle}
      aria-pressed={watchlist.on}
      aria-label={watchlist.on ? `Remove ${item.Name} from watchlist` : `Add ${item.Name} to watchlist`}
      title={watchlist.on ? "On your watchlist" : "Add to watchlist"}
    >
      <Icon name={watchlist.on ? "bookmarkFilled" : "bookmark"} size={18} />
    </button>
  );
}

function SoundButton({ muted, onToggle, className }: { muted: boolean; onToggle: () => void; className: string }) {
  return (
    <button className={className} onClick={onToggle} aria-label={muted ? "Turn the sound on" : "Mute"} title={muted ? "Sound on" : "Mute"}>
      <Icon name={muted ? "volumeOff" : "volume"} size={16} />
    </button>
  );
}

// ---- desktop: the card expands in place ------------------------------------------------------

const MARGIN = 12;

function place(target: HoverTarget): CSSProperties {
  const r = target.anchor.getBoundingClientRect();
  const width = Math.min(Math.max(r.width * (target.variant === "poster" ? 1.75 : 1.3), 340), 470);
  const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - width / 2), window.innerWidth - width - MARGIN);
  // The picture sits over the card's own, centred on it; the details hang below.
  const cardMedia = target.variant === "poster" ? r.width * 1.5 : (r.width * 9) / 16;
  const mediaHeight = (width * 9) / 16;
  const estimated = mediaHeight + 190;
  let top = r.top + cardMedia / 2 - mediaHeight / 2;
  top = Math.min(top, window.innerHeight - estimated - MARGIN);
  top = Math.max(MARGIN, top);
  const originX = r.left + r.width / 2 - left;
  const originY = r.top + cardMedia / 2 - top;
  return { left, top, width, transformOrigin: `${originX}px ${originY}px` };
}

function HoverCard({ target }: { target: HoverTarget }) {
  const navigate = useNavigate();
  const item = usePreviewDetails(target.item)!;
  const [muted, setMuted] = useState(true);
  const [style] = useState(() => place(target));

  useEffect(() => {
    // The card moved out from under it, or the window changed: it no longer belongs there.
    const close = () => closeHover();
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (to: string) => {
    closeHover();
    navigate(to);
  };
  const genres = (item.Genres ?? []).slice(0, 3);

  return createPortal(
    <div className="hpreview" style={style} onMouseEnter={hoverHold} onMouseLeave={hoverLeave} role="dialog" aria-label={`Preview: ${headline(item)}`}>
      <button className="hpreview__media" onClick={() => go(detailsPath(item))} aria-label={`Open ${headline(item)}`} tabIndex={-1}>
        <PreviewMedia item={item} delay={900} muted={muted} showLogo={item.Type !== "Episode"} />
      </button>
      {hasPreviewTrailer(item) && <SoundButton className="hpreview__sound" muted={muted} onToggle={() => setMuted(!muted)} />}
      <div className="hpreview__body">
        <div className="hpreview__actions">
          {playable(item) && (
            <button className="hpreview__btn hpreview__btn--play" onClick={() => go(`/play/${item.Id}`)} aria-label={`Play ${item.Name}`} title="Play">
              <Icon name="play" size={18} />
            </button>
          )}
          <WatchlistButton item={item} className="hpreview__btn" />
          <span className="hpreview__spacer" />
          <button className="hpreview__btn" onClick={() => go(detailsPath(item))} aria-label="Details" title="Details">
            <Icon name="chevronDown" size={20} />
          </button>
        </div>
        <h3 className="hpreview__title">{headline(item)}</h3>
        {item.Type === "Episode" && <p className="hpreview__episode">{item.Name}</p>}
        <PreviewMeta item={item} />
        {genres.length > 0 && <p className="hpreview__genres">{genres.join(" · ")}</p>}
        {item.Overview && <p className="hpreview__overview">{item.Overview}</p>}
      </div>
    </div>,
    document.body,
  );
}

// ---- phone: press and hold for a sheet -------------------------------------------------------

function PreviewSheet({ item: base }: { item: BaseItem }) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const item = usePreviewDetails(base)!;
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const go = (to: string) => {
    closeSheet();
    navigate(to);
  };
  const manageable = isAdmin && item.LocationType !== "Virtual";

  return createPortal(
    <div className="modal-backdrop psheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeSheet()} data-nav-trap>
      <div className="psheet" role="dialog" aria-modal="true" aria-label={`Preview: ${headline(item)}`}>
        <span className="psheet__grip" aria-hidden="true" />
        <div className="psheet__media">
          <PreviewMedia item={item} delay={450} muted={muted} showLogo={item.Type !== "Episode"} />
          {hasPreviewTrailer(item) && <SoundButton className="psheet__sound" muted={muted} onToggle={() => setMuted(!muted)} />}
        </div>
        <div className="psheet__body">
          <h2 className="psheet__title">{headline(item)}</h2>
          {item.Type === "Episode" && <p className="psheet__episode">{item.Name}</p>}
          <PreviewMeta item={item} />
          {item.Overview && <p className="psheet__overview">{item.Overview}</p>}
          <div className="psheet__actions">
            {playable(item) && (
              <Button variant="primary" icon="play" onClick={() => go(`/play/${item.Id}`)}>
                Play
              </Button>
            )}
            <WatchlistButton item={item} className="btn btn--icon btn--md psheet__icon" />
            <Button variant="secondary" icon="info" onClick={() => go(detailsPath(item))}>
              Details
            </Button>
            {manageable && (
              <Button
                variant="icon"
                icon="more"
                className="psheet__icon"
                aria-label="More actions"
                onClick={() => {
                  closeSheet();
                  openMenu(item, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, true);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The desktop hover preview and the phone sheet, for every card on every page. */
export function PreviewHost() {
  const platform = usePlatform();
  const prefs = usePreviewPrefs();
  const { hover, sheet } = usePreviewState();
  const location = useLocation();

  useEffect(() => {
    closeHover();
    closeSheet();
  }, [location.pathname, platform]);

  if (!prefs.enabled) return null;
  if (platform === "desktop" && hover) return <HoverCard key={hover.item.Id} target={hover} />;
  if (platform === "mobile" && sheet) return <PreviewSheet key={sheet.Id} item={sheet} />;
  return null;
}

// ---- TV: the spotlight header ------------------------------------------------------------

/** Where a focused row sits while the spotlight is up (spatialNavigation.ts reads it). */
const ROW_TOP_WITH_SPOTLIGHT = 0.53;

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** TV home: the focused card fills a header above the rows, with its trailer after a pause. */
export function TvSpotlight() {
  const platform = usePlatform();
  const prefs = usePreviewPrefs();
  const focus = useSpotlightFocus();
  const active = platform === "tv" && prefs.enabled;
  // Holding an arrow sweeps past many cards: the details wait until you stop.
  const settled = useSettled(focus, 160);
  const shown = focus ? (settled ?? focus) : null;
  const item = usePreviewDetails(active ? shown : null);

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.style.setProperty("--nav-row-top", String(ROW_TOP_WITH_SPOTLIGHT));
    // Focus leaving the rows (the featured header, the rail) takes the spotlight down, and
    // so does a title that isn't in the library. A row's title or tabs keep it as it was.
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".home__rows") || t.closest(".card--external")) setSpotlight(null);
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      root.style.removeProperty("--nav-row-top");
      setSpotlight(null);
    };
  }, [active]);

  if (!active) return null;
  const logo = item ? logoImage(item, 700) : null;
  const genres = (item?.Genres ?? []).slice(0, 3);
  return (
    <div className={`spotlight ${focus ? "is-on" : ""}`} aria-hidden="true">
      {item && (
        <>
          <div className="spotlight__media" key={item.Id}>
            <PreviewMedia item={item} delay={2000} muted active={settled?.Id === item.Id} />
          </div>
          <div className="spotlight__text" key={`text-${item.Id}`}>
            {logo && item.Type !== "Episode" ? (
              <img className="spotlight__logo" src={logo.url} alt="" />
            ) : (
              <h2 className="spotlight__title">{headline(item)}</h2>
            )}
            {item.Type === "Episode" && <p className="spotlight__episode">{item.Name}</p>}
            <PreviewMeta item={item} />
            {genres.length > 0 && <p className="spotlight__genres">{genres.join(" · ")}</p>}
            {item.Overview && <p className="spotlight__overview">{item.Overview}</p>}
          </div>
        </>
      )}
    </div>
  );
}
