// Learn skips (Settings → Skipping, experimental): skips found in chapter names, and the
// intro a viewer keeps jumping over in a season, offered as a Skip card in its other
// episodes. The rules are in skipLearning.ts; what each season has taught Argent is kept
// in the viewer's Jellyfin account, so every device offers the same skips.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSyncedMap } from "@/api/syncedMap";
import { formatClock, TICKS_PER_SECOND } from "@/api/format";
import type { BaseItem, MediaSegment } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { showToast } from "@/components/Toast";
import { logEvent } from "@/features/diagnostics/log";
import {
  chapterSegments,
  continueJump,
  correctedRange,
  editedRange,
  formatSkipTime,
  isIntroJump,
  JUMP_WINDOW_MS,
  learnedSegment,
  matchedRange,
  MAX_ASKS,
  recordJump,
  savedSkips,
  seasonKey,
  withFoundSegments,
  type OpenJump,
  type Range,
  type SavedSkip,
  type SeasonSkips,
} from "./skipLearning";

const seasons = createSyncedMap<SeasonSkips>({ prefsId: "argent-skips", field: "learned", storageKey: "argent.learnedSkips", max: 300 });

const PREF_KEY = "argent.learnSkips";

/** Experimental, off unless turned on (this device). */
export function readLearnSkips(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveLearnSkips(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, String(on));
  } catch {
    /* ignore */
  }
}

/** The signed-in viewer's saved skips, by show and season (Settings, and the editor's All skips tab). */
export function useSavedSkips(): SavedSkip[] {
  const map = seasons.use();
  return useMemo(() => savedSkips(map), [map]);
}

/** Change a saved skip's times, name or ask-or-auto choice. */
export function updateSkip(userId: string, key: string, edit: SkipEdit) {
  const entry = seasons.read(userId)[key];
  if (!entry) return;
  seasons.set(userId, key, { ...entry, range: edit.range, name: edit.name || undefined, auto: edit.auto || undefined });
  logEvent("skips", `Edited ${rangeLabel(edit.range)}${edit.auto ? " (automatic)" : ""} for ${key}`);
}

/** Delete one season's skip (and what led to it), on every device. A toast can bring it back. */
export function deleteSkip(userId: string, key: string) {
  const entry = seasons.read(userId)[key];
  if (!entry) return;
  seasons.remove(userId, key);
  logEvent("skips", `Deleted ${key}`);
  showToast(`Deleted the skip for ${skipPlace(entry)}`, { label: "Undo", run: () => seasons.set(userId, key, entry) });
}

/** Forget every skip and everything learned, on every device. A toast can bring them back. */
export function forgetLearnedSkips(userId: string) {
  const all = seasons.read(userId);
  for (const key of Object.keys(all)) seasons.remove(userId, key);
  logEvent("skips", "Forgot all");
  showToast("Forgot all skips", { label: "Undo", run: () => Object.entries(all).forEach(([key, entry]) => seasons.set(userId, key, entry)) });
}

/** "Some Show, Season 1", as saved; "this season" for one saved without names. */
export function skipPlace(entry: SeasonSkips): string {
  return entry.show ? `${entry.show}${entry.seasonName ? `, ${entry.seasonName}` : ""}` : (entry.seasonName ?? "this season");
}

const seasonLabel = (item: BaseItem) => item.SeasonName ?? (item.ParentIndexNumber !== undefined ? `Season ${item.ParentIndexNumber}` : "this season");
const rangeLabel = (r: Range) => `${formatClock(r.start)}–${formatClock(r.end)}`;

/**
 * The skips for a title: the server's own, plus (with Learn skips on) the kinds it lacks
 * from chapter names, then the season's learned intro. Undefined until the server answers.
 */
export function useSkipSegments(item: BaseItem | undefined, server: MediaSegment[] | undefined): MediaSegment[] | undefined {
  const on = useMemo(readLearnSkips, []);
  const map = seasons.use();
  const key = item ? seasonKey(item) : undefined;
  const entry = key ? map[key] : undefined;
  return useMemo(() => {
    if (!on || !item) return server;
    const duration = (item.RunTimeTicks ?? 0) / TICKS_PER_SECOND;
    const found = chapterSegments(item.Chapters, duration, item.Type === "Episode", item.Id);
    const learned = learnedSegment(entry, item.Id, duration);
    return withFoundSegments(server, learned ? [...found, learned] : found);
  }, [on, item, server, entry]);
}

/** A skip set by hand starts this long (seconds), about an opening's length. */
const NEW_SKIP_SECONDS = 90;

/** After a learned skip is taken, seeking back inside it within this long trims it. */
const CORRECTION_WINDOW_MS = 8000;

/**
 * The skip editor: a learned skip offered (its times editable before saying yes), one opened
 * to adjust, a new one set by hand (the editor's shortcut in a season without one), or only
 * the list of skips (the shortcut in a film).
 */
export interface SkipEditorState {
  mode: "offer" | "edit" | "create" | "list";
  /** The season being watched (absent in a film). */
  key?: string;
  range: Range;
  /** What it's called on its Skip card ("Opening"); undefined for "Intro". */
  name?: string;
  /** Skip it without asking. */
  auto: boolean;
  season: string;
}

/** What the editor saves. */
export type SkipEdit = Pick<SkipEditorState, "range" | "name" | "auto">;

/**
 * Watches the viewer's own seeks in the page's player. Jumping over about the same stretch
 * near the start of two episodes of a season offers to skip it in every episode, in an
 * editor where its start and end can be set exactly; seeking back just after taking a
 * learned skip trims it to where they landed.
 */
export function useSkipLearning(opts: { item: BaseItem; segments: readonly MediaSegment[] | undefined; duration: number; active: boolean }) {
  const { user } = useAuth();
  const on = useMemo(readLearnSkips, []);
  const latest = useRef(opts);
  latest.current = opts;
  const userId = user?.Id;
  const open = useRef<OpenJump | null>(null);
  const jumpTimer = useRef(0);
  const correction = useRef<{ at: number; range: Range; landing?: number } | null>(null);
  const correctionTimer = useRef(0);
  const [editor, setEditor] = useState<SkipEditorState | null>(null);
  const editing = useRef(false);
  editing.current = Boolean(editor);

  useEffect(
    () => () => {
      window.clearTimeout(jumpTimer.current);
      window.clearTimeout(correctionTimer.current);
    },
    [],
  );

  const finishJump = useCallback(() => {
    const j = open.current;
    open.current = null;
    const { item, duration } = latest.current;
    const key = seasonKey(item);
    if (!j || !userId || !key || !isIntroJump(j.from, j.to, duration)) return;
    const jump = { ep: item.Id, from: Math.round(j.from * 10) / 10, to: Math.round(j.to * 10) / 10, at: Date.now() };
    const entry = recordJump(seasons.read(userId)[key], jump);
    const range = (entry.asked ?? 0) < MAX_ASKS ? matchedRange(entry, jump) : undefined;
    seasons.set(userId, key, range ? { ...entry, asked: (entry.asked ?? 0) + 1 } : entry);
    logEvent("skips", `Jump ${rangeLabel({ start: jump.from, end: jump.to })} in ${item.Id}${range ? `; offering ${rangeLabel(range)} for ${key}` : ""}`);
    if (range) setEditor({ mode: "offer", key, range, auto: false, season: seasonLabel(item) });
  }, [userId]);

  const finishCorrection = useCallback(() => {
    const c = correction.current;
    correction.current = null;
    const key = seasonKey(latest.current.item);
    if (!c || c.landing === undefined || !userId || !key) return;
    const fixed = correctedRange(c.range, c.landing);
    const entry = seasons.read(userId)[key];
    if (!fixed || !entry?.range) return;
    seasons.set(userId, key, { ...entry, range: fixed });
    logEvent("skips", `Trimmed ${key} to ${rangeLabel(fixed)}`);
    showToast(`Got it. Skips in ${seasonLabel(latest.current.item)} now end at ${formatClock(fixed.end)}`, { label: "Adjust", run: () => adjustRef.current() });
  }, [userId]);

  /** A seek the viewer made: keys, the seek bar, double-tap, a remote or another app. */
  const observe = useCallback(
    (from: number, to: number) => {
      const { item, segments, active } = latest.current;
      // While the editor is open, seeks are for finding the right moment.
      if (!on || !active || !userId || !seasonKey(item) || editing.current) return;
      const now = Date.now();
      const c = correction.current;
      if (c && now - c.at < CORRECTION_WINDOW_MS) {
        // Going back into the skip just taken (perhaps a few presses): trim it once they settle.
        c.at = now;
        c.landing = to;
        window.clearTimeout(correctionTimer.current);
        correctionTimer.current = window.setTimeout(finishCorrection, JUMP_WINDOW_MS);
        return;
      }
      correction.current = null;
      // A title with an intro already (the server's, a chapter's or learned) has nothing to learn.
      if (segments?.some((s) => s.Type === "Intro")) return;
      open.current = continueJump(open.current, from, to, now);
      window.clearTimeout(jumpTimer.current);
      if (open.current) jumpTimer.current = window.setTimeout(finishJump, JUMP_WINDOW_MS);
    },
    [on, userId, finishJump, finishCorrection],
  );

  /** Open the editor on this season's learned skip. */
  const adjust = useCallback(() => {
    const { item } = latest.current;
    const key = seasonKey(item);
    const entry = userId && key ? seasons.read(userId)[key] : undefined;
    if (!entry?.range) return;
    correction.current = null;
    setEditor({ mode: "edit", key, range: entry.range, name: entry.name, auto: Boolean(entry.auto), season: seasonLabel(item) });
  }, [userId]);
  const adjustRef = useRef(adjust);
  adjustRef.current = adjust;

  /**
   * The editor's shortcut: the season's skip to adjust, or a new one from where the video
   * is (a typical opening's length, to set exactly); in a film, the list of skips. Pressed
   * again, it closes the editor.
   */
  const toggleEditor = useCallback(
    (currentSeconds: number) => {
      if (editing.current) {
        setEditor(null);
        return;
      }
      const { item, duration } = latest.current;
      const key = seasonKey(item);
      if (!on) {
        showToast("Turn on Learn skips in Settings → Skipping to set skips");
        return;
      }
      if (!userId) return;
      if (!key) {
        setEditor({ mode: "list", range: { start: 0, end: 0 }, auto: false, season: "" });
        return;
      }
      if (seasons.read(userId)[key]?.range) {
        adjust();
        return;
      }
      correction.current = null;
      const range = editedRange({ start: currentSeconds, end: currentSeconds + NEW_SKIP_SECONDS }, "end", currentSeconds + NEW_SKIP_SECONDS, duration);
      setEditor({ mode: "create", key, range, auto: false, season: seasonLabel(item) });
    },
    [on, userId, adjust],
  );

  /** The Skip card was pressed. On a learned intro, say where it came from and offer to adjust it. */
  const skipped = useCallback(
    (segment: MediaSegment) => {
      const { item } = latest.current;
      const key = seasonKey(item);
      if (segment.Source !== "learned" || !userId || !key) return;
      correction.current = { at: Date.now(), range: { start: segment.StartTicks / TICKS_PER_SECOND, end: segment.EndTicks / TICKS_PER_SECOND } };
      showToast("Skipped. Argent learned this from your skips", { label: "Adjust", run: adjust });
    },
    [userId, adjust],
  );

  /** Save the editor's times, name and choice as the season's skip. */
  const save = useCallback(
    ({ range, name, auto }: SkipEdit) => {
      const { item, duration } = latest.current;
      const key = seasonKey(item);
      if (!userId || !key) return;
      const mode = editor?.mode;
      const ref = duration > 0 ? Math.round(duration) : undefined;
      // The show and season go with it, for the list of skips.
      const place = { show: item.SeriesName, seasonName: seasonLabel(item), seriesId: item.SeriesId };
      seasons.set(userId, key, { ...(seasons.read(userId)[key] ?? { jumps: [] }), range, name: name || undefined, auto: auto || undefined, ref, ...place });
      logEvent("skips", `${mode === "offer" ? "Learned" : mode === "create" ? "Set" : "Adjusted"} ${rangeLabel(range)}${auto ? " (automatic)" : ""} for ${key}`);
      setEditor(null);
      showToast(`Saved for every episode of ${seasonLabel(latest.current.item)}: ${auto ? "skips" : "asks to skip"} ${formatSkipTime(range.start)}–${formatSkipTime(range.end)}`);
    },
    [userId, editor?.mode],
  );

  /** Delete the season's skip (and what led to it); the toast can bring it back. */
  const forget = useCallback(() => {
    const key = seasonKey(latest.current.item);
    if (!userId || !key) return;
    deleteSkip(userId, key);
    setEditor(null);
  }, [userId]);

  const close = useCallback(() => setEditor(null), []);

  return useMemo(() => ({ observe, skipped, editor, adjust, toggleEditor, save, forget, close }), [observe, skipped, editor, adjust, toggleEditor, save, forget, close]);
}
