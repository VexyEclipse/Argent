import { useEffect, useRef, type RefObject } from "react";
import { syncPlay } from "@/api/sessions";
import { logEvent } from "@/features/diagnostics/log";
import { currentQueueItem, getTogether, serverNow, useTogether } from "./store";
import { driftFix, groupPosition, toLocal } from "./syncLogic";

const TICKS = 10_000_000;

/**
 * The player's half of Watch Together. While this title is the group's current item,
 * play, pause and seek go to the group instead of the video, and the group's commands
 * are carried out on schedule (by the server's clock), with drift evened out.
 */
export function useSyncPlayer(opts: { video: RefObject<HTMLVideoElement | null>; itemId: string | undefined; onStop: () => void }) {
  const { video, itemId } = opts;
  const together = useTogether();
  const queued = currentQueueItem(together);
  const active = Boolean(together.group && itemId && queued?.ItemId === itemId);
  const playlistItemId = active ? queued!.PlaylistItemId : null;
  const latest = useRef(opts);
  latest.current = opts;

  // ---- report readiness and buffering ---------------------------------------------
  useEffect(() => {
    const el = video.current;
    if (!el || !playlistItemId) return;
    let waiting = false;
    let readyTimer = 0;
    const position = () => el.currentTime * TICKS;
    const ready = () => {
      window.clearTimeout(readyTimer);
      // Settle first: a seek fires canplay and seeked together.
      readyTimer = window.setTimeout(() => {
        waiting = false;
        syncPlay.ready(serverNow(), position(), !el.paused, playlistItemId).catch(() => {});
      }, 250);
    };
    const buffering = () => {
      if (waiting) return;
      waiting = true;
      syncPlay.buffering(serverNow(), position(), !el.paused, playlistItemId).catch(() => {});
    };
    const onCanPlay = () => ready();
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("seeked", onCanPlay);
    el.addEventListener("waiting", buffering);
    if (el.readyState >= 3) ready();
    return () => {
      window.clearTimeout(readyTimer);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("seeked", onCanPlay);
      el.removeEventListener("waiting", buffering);
    };
  }, [video, playlistItemId]);

  // ---- carry out the group's commands ------------------------------------------------
  const command = together.command;
  useEffect(() => {
    const el = video.current;
    if (!el || !command || !playlistItemId || command.PlaylistItemId !== playlistItemId) return;
    const offset = getTogether().offsetMs;
    const target = command.PositionTicks / TICKS;
    const place = (seconds: number) => {
      if (Math.abs(el.currentTime - seconds) > 0.3) el.currentTime = seconds;
    };
    let timer = 0;
    switch (command.Command) {
      case "Unpause": {
        const wait = toLocal(command.When, offset) - Date.now();
        if (wait > 0) {
          place(target);
          timer = window.setTimeout(() => el.play().catch(() => {}), wait);
        } else {
          place(groupPosition(command, offset, Date.now()));
          el.play().catch(() => {});
        }
        break;
      }
      case "Pause":
        el.pause();
        place(target);
        break;
      case "Seek":
        el.pause();
        place(target);
        break;
      case "Stop":
        latest.current.onStop();
        break;
    }
    logEvent("together", `${command.Command} at ${target.toFixed(1)}s`);
    return () => window.clearTimeout(timer);
  }, [command, playlistItemId, video]);

  // ---- even out drift while playing -----------------------------------------------
  useEffect(() => {
    const el = video.current;
    if (!el || !playlistItemId) return;
    const timer = window.setInterval(() => {
      const s = getTogether();
      const c = s.command;
      if (!c || c.Command !== "Unpause" || c.PlaylistItemId !== playlistItemId || el.paused || el.seeking) {
        if (el.playbackRate !== 1 && !el.paused) el.playbackRate = 1;
        return;
      }
      const fix = driftFix(el.currentTime, groupPosition(c, s.offsetMs, Date.now()));
      if (fix.kind === "seek") el.currentTime = fix.to;
      el.playbackRate = fix.kind === "rate" ? fix.rate : 1;
    }, 1000);
    return () => {
      window.clearInterval(timer);
      el.playbackRate = 1;
    };
  }, [video, playlistItemId]);

  if (!active) return null;
  const queue = together.queue;
  const index = together.playingIndex;
  return {
    group: together.group!,
    hasNext: index < queue.length - 1,
    hasPrevious: index > 0,
    toggle: () => (video.current?.paused ? syncPlay.unpause() : syncPlay.pause()).catch(() => {}),
    pause: () => syncPlay.pause().catch(() => {}),
    unpause: () => syncPlay.unpause().catch(() => {}),
    seek: (seconds: number) => syncPlay.seek(Math.max(0, seconds) * TICKS).catch(() => {}),
    next: () => syncPlay.nextItem(playlistItemId!).catch(() => {}),
    previous: () => syncPlay.previousItem(playlistItemId!).catch(() => {}),
  };
}

export type SyncPlayer = NonNullable<ReturnType<typeof useSyncPlayer>>;
