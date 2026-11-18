import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
//
// The card's own picture grows into the preview (and fades into the backdrop as it does),
// the details unfold below it, and the cards beside it slide aside to make room. Closing
// runs the same the other way, back into the card.

const MARGIN = 12;
const OPEN_MS = 320;
const CLOSE_MS = 230;
const OPEN_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const CLOSE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const mediaOf = (anchor: HTMLElement) => anchor.querySelector<HTMLElement>(".card__media") ?? anchor;

/** The card's slot in its row or grid (a ranked card sits in its own wrapper). */
function slotOf(anchor: HTMLElement): HTMLElement {
  let el = anchor;
  while (el.parentElement && !el.parentElement.matches(".row__track, .grid")) el = el.parentElement;
  return el.parentElement ? el : anchor;
}

// The cards slid aside for the open preview, and by how much.
let pushed = new Map<HTMLElement, number>();
let pushOwner: object | null = null;

function slide(el: HTMLElement, shift: number, opening: boolean) {
  el.style.transition = `transform ${opening ? OPEN_MS : CLOSE_MS}ms ${opening ? OPEN_EASE : CLOSE_EASE}`;
  el.style.transform = shift ? `translateX(${shift}px)` : "";
  if (!shift) {
    const done = () => {
      if (!pushed.has(el)) el.style.transition = "";
    };
    el.addEventListener("transitionend", done, { once: true });
  }
}

/** Slides the cards on the same line as `anchor` out of the preview's way. */
function makeRoom(owner: object, anchor: HTMLElement, left: number, right: number) {
  pushOwner = owner;
  const slot = slotOf(anchor);
  const line = slot.getBoundingClientRect().top;
  const next = new Map<HTMLElement, number>();
  let before = true;
  for (const el of Array.from(slot.parentElement?.children ?? []) as HTMLElement[]) {
    if (el === slot) {
      before = false;
      continue;
    }
    if (Math.abs(el.getBoundingClientRect().top - line) > 2) continue;
    const shift = Math.round(before ? -left : right);
    if (shift) next.set(el, shift);
  }
  const previous = pushed;
  pushed = next;
  previous.forEach((_, el) => !next.has(el) && slide(el, 0, false));
  next.forEach((shift, el) => slide(el, shift, true));
}

function giveRoomBack(owner: object) {
  if (pushOwner !== owner) return;
  pushOwner = null;
  const previous = pushed;
  pushed = new Map();
  previous.forEach((_, el) => slide(el, 0, false));
}

interface Placement {
  left: number;
  top: number;
  width: number;
  mediaHeight: number;
  /** How far the preview reaches past the card on each side. */
  overLeft: number;
  overRight: number;
}

function place(target: HoverTarget): Placement {
  const r = mediaOf(target.anchor).getBoundingClientRect();
  // Where the card belongs, not where it was slid to for another card's preview.
  const cardLeft = r.left - (pushed.get(slotOf(target.anchor)) ?? 0);
  const width = Math.min(Math.max(r.width * (target.variant === "poster" ? 1.75 : 1.3), 340), 470);
  const left = Math.min(Math.max(MARGIN, cardLeft + r.width / 2 - width / 2), window.innerWidth - width - MARGIN);
  // The picture sits over the card's own, centred on it; the details hang below.
  const mediaHeight = ((width - 2) * 9) / 16;
  const estimated = mediaHeight + 190;
  let top = r.top + r.height / 2 - mediaHeight / 2;
  top = Math.min(top, window.innerHeight - estimated - MARGIN);
  top = Math.max(MARGIN, top);
  return { left, top, width, mediaHeight, overLeft: Math.max(0, cardLeft - left), overRight: Math.max(0, left + width - (cardLeft + r.width)) };
}

/** The picture the card is showing, to grow out of. */
function cardArt(anchor: HTMLElement): string | null {
  const img = mediaOf(anchor).querySelector("img");
  return img?.currentSrc || img?.src || null;
}

interface MorphEls {
  box: HTMLElement;
  inner: HTMLElement;
  ghost: HTMLElement;
}

const px = (n: number) => `${n}px`;

/** Grows the preview out of the card (or shrinks it back into it). */
function morph(els: MorphEls, card: DOMRect, cardRadius: number, p: Placement, opening: boolean): Animation {
  const options: KeyframeAnimationOptions = { duration: opening ? OPEN_MS : CLOSE_MS, easing: opening ? OPEN_EASE : CLOSE_EASE, fill: opening ? "none" : "forwards" };
  const small = { left: px(card.left), top: px(card.top), width: px(card.width), height: px(card.height), borderRadius: px(cardRadius) };
  const ghostSmall = { height: px(card.height), opacity: 1 };
  // The details stay put on screen while the box around them grows.
  const innerSmall = { transform: `translate(${card.left - p.left}px, ${card.top - p.top}px)` };

  if (opening) {
    const big = { left: px(p.left), top: px(p.top), width: px(p.width), height: px(els.box.offsetHeight), borderRadius: "16px" };
    els.inner.animate([innerSmall, { transform: "none" }], options);
    els.ghost.animate([ghostSmall, { opacity: 1, offset: 0.3 }, { height: px(p.mediaHeight), opacity: 0 }], options);
    return els.box.animate([small, big], options);
  }

  // From wherever it is now (it may still be opening).
  const box = els.box.getBoundingClientRect();
  const boxStyle = getComputedStyle(els.box);
  const ghostStyle = getComputedStyle(els.ghost);
  const now = {
    box: { left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height), borderRadius: boxStyle.borderTopLeftRadius },
    inner: { transform: getComputedStyle(els.inner).transform },
    ghost: { height: ghostStyle.height, opacity: Number(ghostStyle.opacity) },
  };
  for (const el of [els.box, els.inner, els.ghost]) el.getAnimations().forEach((a) => a.cancel());
  els.inner.animate([now.inner, innerSmall], options);
  els.ghost.animate([now.ghost, { opacity: 1, offset: 0.45 }, ghostSmall], options);
  return els.box.animate([now.box, small], options);
}

function HoverCard({ target, leaving, onGone }: { target: HoverTarget; leaving: boolean; onGone: () => void }) {
  const navigate = useNavigate();
  const prefs = usePreviewPrefs();
  const item = usePreviewDetails(target.item)!;
  const [muted, setMuted] = useState(true);
  const [p] = useState(() => place(target));
  const [art] = useState(() => cardArt(target.anchor));
  const [owner] = useState(() => ({}));
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const opened = useRef<DOMRect | null>(null);
  const gone = useRef(onGone);
  gone.current = onGone;

  // Open: out of the card, before the first paint so the two never show at once.
  useLayoutEffect(() => {
    if (prefs.makeRoom) makeRoom(owner, target.anchor, p.overLeft, p.overRight);
    const card = mediaOf(target.anchor);
    opened.current = card.getBoundingClientRect();
    if (reducedMotion() || !box.current || !inner.current || !ghost.current) return;
    morph({ box: box.current, inner: inner.current, ghost: ghost.current }, opened.current, parseFloat(getComputedStyle(card).borderTopLeftRadius) || 10, p, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => giveRoomBack(owner), [owner]);

  // Close: back into the card, or a quick fade if the card has moved (a scroll) or gone.
  useLayoutEffect(() => {
    if (!leaving) return;
    giveRoomBack(owner);
    const els = box.current && inner.current && ghost.current ? { box: box.current, inner: inner.current, ghost: ghost.current } : null;
    if (!els || reducedMotion()) return gone.current();
    const card = mediaOf(target.anchor);
    const now = card.getBoundingClientRect();
    const was = opened.current;
    const moved = !target.anchor.isConnected || !was || Math.abs(now.left - was.left) > 2 || Math.abs(now.top - was.top) > 2;
    const animation = moved
      ? els.box.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.97)" }], { duration: 140, easing: CLOSE_EASE, fill: "forwards" })
      : morph(els, now, parseFloat(getComputedStyle(card).borderTopLeftRadius) || 10, p, false);
    let cancelled = false;
    animation.finished.then(
      () => !cancelled && gone.current(),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [leaving, owner, p, target.anchor]);

  useEffect(() => {
    if (leaving) return;
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
  }, [leaving]);

  const go = (to: string) => {
    closeHover();
    navigate(to);
  };
  const genres = (item.Genres ?? []).slice(0, 3);
  // Inside its 1px border.
  const innerWidth = p.width - 2;

  return createPortal(
    <div
      ref={box}
      className={`hpreview ${leaving ? "is-leaving" : ""}`}
      style={{ left: p.left, top: p.top, width: p.width }}
      onMouseEnter={hoverHold}
      onMouseLeave={hoverLeave}
      role="dialog"
      aria-label={`Preview: ${headline(item)}`}
      aria-hidden={leaving || undefined}
    >
      <div ref={inner} className="hpreview__inner" style={{ width: innerWidth }}>
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
      </div>
      {/* The card's own picture, which grows into the preview's and fades as it does. */}
      <div ref={ghost} className="hpreview__ghost" style={{ height: (innerWidth * 9) / 16 }} aria-hidden="true">
        {art && <img src={art} alt="" />}
      </div>
    </div>,
    document.body,
  );
}

let shownSeq = 0;
interface Shown {
  id: number;
  target: HoverTarget;
  leaving: boolean;
}

/** The open preview, and any still folding back into their cards. */
function HoverLayer({ hover }: { hover: HoverTarget | null }) {
  const [shown, setShown] = useState<Shown[]>([]);
  const [last, setLast] = useState<HoverTarget | null>(null);
  if (hover !== last) {
    setLast(hover);
    setShown((prev) => {
      // A card opened again while it was still closing: the new preview takes over at once.
      const next = prev
        .filter((s) => !(hover && s.target.anchor === hover.anchor && s.target !== hover))
        .map((s) => (s.target === hover || s.leaving ? s : { ...s, leaving: true }));
      if (hover && !next.some((s) => s.target === hover)) next.push({ id: ++shownSeq, target: hover, leaving: false });
      return next;
    });
  }

  // A card stands in for its preview while it's out, so the two never show at once.
  useLayoutEffect(() => {
    const anchors = new Set(shown.map((s) => s.target.anchor));
    anchors.forEach((a) => a.classList.add("is-expanded"));
    return () => anchors.forEach((a) => a.classList.remove("is-expanded"));
  }, [shown]);

  const remove = useCallback((id: number) => setShown((prev) => prev.filter((s) => s.id !== id)), []);
  return (
    <>
      {shown.map((s) => (
        <HoverCard key={s.id} target={s.target} leaving={s.leaving} onGone={() => remove(s.id)} />
      ))}
    </>
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
  if (platform === "desktop") return <HoverLayer hover={hover} />;
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
