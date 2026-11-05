import { useCallback, useEffect, useState, type RefObject } from "react";
import type { BaseItem, MediaSegment } from "@/api/types";
import { readAutoplayChain, writeAutoplayChain } from "./prefs";
import { shouldAskStillWatching, upNextAt } from "./playerLogic";

/**
 * Up Next near the end of an episode, the autoplay countdown, and the "Are you still
 * watching?" pause after a few unattended episodes, so a player left running doesn't
 * work through a season (and mark it watched) on its own.
 */
export function useUpNext(opts: {
  video: RefObject<HTMLVideoElement | null>;
  next: BaseItem | null;
  segments: readonly MediaSegment[] | undefined;
  current: number;
  duration: number;
  playing: boolean;
  autoplayEnabled: boolean;
  playItem: (item: BaseItem | null | undefined) => void;
  exit: () => void;
}) {
  const { video, next, segments, current, duration, playing, autoplayEnabled, playItem, exit } = opts;
  const [dismissed, setDismissed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [stillWatching, setStillWatching] = useState(false);
  const autoplay = autoplayEnabled && !stillWatching;

  const autoplayNext = useCallback(() => {
    if (!next) return;
    if (shouldAskStillWatching(readAutoplayChain())) {
      video.current?.pause();
      setCountdown(null);
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

  const showUpNext = Boolean(next && duration > 60 && current >= upNextAt(segments, duration) && !dismissed);

  useEffect(() => {
    if (!showUpNext || !autoplay) {
      setCountdown(null);
      return;
    }
    setCountdown((c) => c ?? 10);
  }, [showUpNext, autoplay]);
  useEffect(() => {
    if (countdown === null || !playing) return;
    if (countdown <= 0) {
      autoplayNext();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, playing, autoplayNext]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onEnded = () => {
      if (next && autoplay) autoplayNext();
      else if (!stillWatching) exit();
    };
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [next, autoplay, autoplayNext, exit, stillWatching, video]);

  const keepWatching = () => {
    writeAutoplayChain(0);
    playItem(next);
  };

  return { showUpNext, countdown, stillWatching, dismiss: () => setDismissed(true), keepWatching, autoplayNext };
}
