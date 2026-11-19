// Previews of a title before you open it, a different way on each device (the way the big
// streaming apps do it):
//   desktop: hovering a card for a moment expands it in place, with a muted trailer;
//   TV:      the focused card fills a spotlight header above the rows;
//   phone:   pressing and holding a card opens a preview sheet.
// This is the small shared state behind them, and their settings.

import { useSyncExternalStore } from "react";
import type { BaseItem } from "@/api/types";

// ---- settings (this device) ------------------------------------------------------------------

export interface PreviewPrefs {
  /** Previews at all. */
  enabled: boolean;
  /** Play trailers in them (muted until you turn the sound on). */
  trailers: boolean;
  /** Desktop: the cards beside a preview slide aside to make room for it. */
  makeRoom: boolean;
}

const PREFS_KEY = "argent.previews";
const DEFAULTS: PreviewPrefs = { enabled: true, trailers: true, makeRoom: true };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

let prefsCache: { raw: string | null; value: PreviewPrefs } = { raw: null, value: DEFAULTS };

export function readPreviewPrefs(): PreviewPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    /* ignore */
  }
  if (raw === prefsCache.raw) return prefsCache.value;
  let value = DEFAULTS;
  try {
    value = { ...DEFAULTS, ...JSON.parse(raw || "{}") };
  } catch {
    /* ignore */
  }
  prefsCache = { raw, value };
  return value;
}

export function setPreviewPref<K extends keyof PreviewPrefs>(key: K, value: PreviewPrefs[K]) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPreviewPrefs(), [key]: value }));
  } catch {
    /* ignore */
  }
  if (!readPreviewPrefs().enabled) set({ hover: null, focus: null, sheet: null });
  emit();
}

export const usePreviewPrefs = () => useSyncExternalStore(subscribe, readPreviewPrefs);

/** Trailers in previews: wanted, and not on a connection that asked to save data. */
export function trailersAllowed(): boolean {
  const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  return readPreviewPrefs().trailers && !saveData;
}

// ---- what's being previewed ------------------------------------------------------------------

export interface HoverTarget {
  item: BaseItem;
  /** The card, to place the preview over it. */
  anchor: HTMLElement;
  variant: "poster" | "landscape";
  /** The card has a "Remind me" bell (Coming Up): so does its preview. */
  remind?: boolean;
  /** The card has no play button (not aired yet): nor does its preview. */
  noPlay?: boolean;
}

interface State {
  hover: HoverTarget | null;
  /** TV: the card in focus, shown in the spotlight. */
  focus: BaseItem | null;
  /** Phone: the card held down, shown in a sheet. */
  sheet: BaseItem | null;
  /** A preview trailer is playing (the featured header pauses its own meanwhile). */
  playing: boolean;
}

let state: State = { hover: null, focus: null, sheet: null, playing: false };

function set(next: Partial<State>) {
  state = { ...state, ...next };
  emit();
}

export const readPreviewState = () => state;
export const usePreviewState = () => useSyncExternalStore(subscribe, readPreviewState);
export const useSpotlightFocus = () => useSyncExternalStore(subscribe, () => state.focus);
/** Whether something is playing or spotlit over the page (the featured header pauses). */
export const usePreviewCovers = () => useSyncExternalStore(subscribe, () => state.playing || state.focus !== null);

// Desktop hover: a card opens once the pointer has come to rest on it, not while it passes
// over on its way somewhere else, and not when scrolling (or the page shifting) brings the
// card under a pointer that's standing still: that waits until the pointer moves. A preview
// closes a moment after the pointer leaves (so it can travel from the card onto it).

/** How long the pointer rests on a card before it opens. */
const OPEN_REST_MS = 500;
/** With another preview open, to move it along to this card. */
const SWITCH_REST_MS = 250;
/** Moving less than this still counts as resting (a hand on the mouse is never quite still). */
const REST_RADIUS = 10;
/** A real move this recent made the enter (the move event can come just after it). */
const MOVED_IN_MS = 100;
const CLOSE_AFTER_MS = 140;
let openTimer = 0;
let closeTimer = 0;

/** The card under the pointer, waiting for the pointer to rest on it. */
let pending: { target: HoverTarget; armed: boolean; since: number } | null = null;
/** Where the pointer last really moved to, and where (and since when) it has been resting. */
const pointer = { x: NaN, y: NaN, at: -Infinity, restX: NaN, restY: NaN, restSince: -Infinity };
let tracking = false;

function onPointerMove(e: PointerEvent) {
  if (e.pointerType === "touch") return;
  // Not a move: the browser saying again where the pointer is after the page moved under it.
  if (Math.abs(e.clientX - pointer.x) < 0.5 && Math.abs(e.clientY - pointer.y) < 0.5) return;
  const now = performance.now();
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.at = now;
  if (!(Math.hypot(e.clientX - pointer.restX, e.clientY - pointer.restY) <= REST_RADIUS)) {
    pointer.restX = e.clientX;
    pointer.restY = e.clientY;
    pointer.restSince = now;
  }
  // The pointer moving on the card it had stood still over: now it may open.
  if (pending && !pending.armed) arm(now);
}

function onScroll(e: Event) {
  // The card is scrolling under the pointer: it waits for the pointer to move again.
  const scrolled = e.target as Partial<Node> | null;
  if (!pending?.armed || !scrolled?.contains?.(pending.target.anchor)) return;
  pending.armed = false;
  window.clearTimeout(openTimer);
}

function track() {
  if (tracking) return;
  tracking = true;
  window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
}

function arm(now: number) {
  if (!pending) return;
  pending.armed = true;
  pending.since = now;
  window.clearTimeout(closeTimer);
  settle();
}

/** Opens the pending card once the pointer has rested on it long enough, else checks again then. */
function settle() {
  window.clearTimeout(openTimer);
  if (!pending?.armed) return;
  const { target } = pending;
  if (!target.anchor.isConnected) {
    pending = null;
    return;
  }
  const due = Math.max(pending.since, pointer.restSince) + (state.hover ? SWITCH_REST_MS : OPEN_REST_MS);
  const wait = due - performance.now();
  if (wait > 1) {
    openTimer = window.setTimeout(settle, wait);
    return;
  }
  pending = null;
  set({ hover: target, playing: false });
}

export function hoverEnter(target: HoverTarget) {
  track();
  window.clearTimeout(openTimer);
  if (state.hover?.anchor === target.anchor) {
    pending = null;
    window.clearTimeout(closeTimer);
    return;
  }
  const now = performance.now();
  pending = { target, armed: false, since: now };
  // The pointer came onto the card. Otherwise the card came under it (a scroll, the page
  // shifting), and it waits for the pointer to move; meanwhile any open preview closes.
  if (now - pointer.at < MOVED_IN_MS) arm(now);
}

export function hoverLeave() {
  pending = null;
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => set({ hover: null, playing: false }), CLOSE_AFTER_MS);
}

/** The pointer is over the preview itself: keep it. */
export function hoverHold() {
  window.clearTimeout(closeTimer);
}

export function closeHover() {
  pending = null;
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  if (state.hover) set({ hover: null, playing: false });
}

export function setSpotlight(item: BaseItem | null) {
  if (state.focus?.Id === item?.Id) return;
  set({ focus: item, playing: false });
}

export const openSheet = (item: BaseItem) => set({ sheet: item, playing: false });
export const closeSheet = () => set({ sheet: null, playing: false });
export const setPreviewPlaying = (playing: boolean) => {
  if (state.playing !== playing) set({ playing });
};
