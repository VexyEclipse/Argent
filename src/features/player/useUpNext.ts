import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { BaseItem } from "@/api/types";
import { readAutoplayChain, writeAutoplayChain } from "./prefs";
import { shouldAskStillWatching, upNextCardAt } from "./playerLogic";

/** Stuck this long in the last moments of an episode counts as its end. */
const STALLED_AT_END_MS = 4000;
const END_MARGIN_SECONDS = 1.5;

/**
 * Up Next for the last ten seconds of an episode, moving on when the episode ends (its
 * button goes early), and the "Are you still watching?" pause after a few unattended
 * episodes, so a player left running doesn't work through a season (and mark it watched)
 * on its own.
 */
export function useUpNext(opts: {
  video: RefObject<HTMLVideoElement | null>;
  next: BaseItem | null;
  current: number;
  duration: number;
  playing: boolean;
  autoplayEnabled: boolean;
  playItem: (item: BaseItem | null | undefined) => void;
  exit: () => void;
}) {
  const { video, next, current, playing, autoplayEnabled, playItem, exit } = opts;
  const [dismissed, setDismissed] = useState(false);
  const [stillWatching, setStillWatching] = useState(false);
  const autoplay = autoplayEnabled && !stillWatching;
  // The stream's own length where the browser knows it: the library's can be off by a few seconds.
  const own = video.current?.duration;
  const duration = own && Number.isFinite(own) ? own : opts.duration;

  const autoplayNext = useCallback(() => {
    if (!next) return;
    if (shouldAskStillWatching(readAutoplayChain())) {
      video.current?.pause();
      setStillWatching(true);
      return;
    }
    writeAutoplayChain(readAutoplayChain() + 1);
    playItem(next);
  }, [next, playItem, video]);

  // Any input from the viewer proves someone is watching.
  useEffect(() => {
    const reset = () => writeAutoplayChain(0);
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, []);

  const showUpNext = Boolean(next && duration > 60 && current >= upNextCardAt(duration) && !dismissed);
  // Seconds left, shown on the card when the next episode will follow.
  const countdown = showUpNext && autoplay ? Math.max(0, Math.ceil(duration - current)) : null;

  // The episode ending moves on (or closes the player), once.
  const ended = useRef(false);
  const onEnded = useRef(() => {});
  onEnded.current = () => {
    if (ended.current) return;
    ended.current = true;
    if (next && autoplay) autoplayNext();
    else if (!stillWatching) exit();
  };
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const handle = () => onEnded.current();
    el.addEventListener("ended", handle);
    return () => el.removeEventListener("ended", handle);
  }, [video]);
  // A transcode can run dry a moment before the end without the browser saying it ended.
  useEffect(() => {
    if (!playing || !duration || duration - current > END_MARGIN_SECONDS) return;
    const t = window.setTimeout(() => onEnded.current(), STALLED_AT_END_MS);
    return () => window.clearTimeout(t);
  }, [current, playing, duration]);

  const keepWatching = () => {
    writeAutoplayChain(0);
    playItem(next);
  };

  return { showUpNext, countdown, stillWatching, dismiss: () => setDismissed(true), keepWatching, autoplayNext };
}
