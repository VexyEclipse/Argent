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
}

const PREFS_KEY = "argent.previews";
const DEFAULTS: PreviewPrefs = { enabled: true, trailers: true };
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

export const usePreviewState = () => useSyncExternalStore(subscribe, () => state);
export const useSpotlightFocus = () => useSyncExternalStore(subscribe, () => state.focus);
/** Whether something is playing or spotlit over the page (the featured header pauses). */
export const usePreviewCovers = () => useSyncExternalStore(subscribe, () => state.playing || state.focus !== null);

// Desktop hover: open after the pointer rests, close a moment after it leaves (so it can
// travel from the card onto the preview without it closing).
const OPEN_AFTER_MS = 650;
const CLOSE_AFTER_MS = 140;
let openTimer = 0;
let closeTimer = 0;

export function hoverEnter(target: HoverTarget) {
  window.clearTimeout(closeTimer);
  window.clearTimeout(openTimer);
  if (state.hover?.anchor === target.anchor) return;
  openTimer = window.setTimeout(
    () => {
      if (target.anchor.isConnected) set({ hover: target, playing: false });
    },
    state.hover ? 120 : OPEN_AFTER_MS,
  );
}

export function hoverLeave() {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => set({ hover: null, playing: false }), CLOSE_AFTER_MS);
}

/** The pointer is over the preview itself: keep it. */
export function hoverHold() {
  window.clearTimeout(closeTimer);
}

export function closeHover() {
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
