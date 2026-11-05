import { useEffect, type RefObject } from "react";
import { landscapeImage } from "@/api/images";
import { episodeCode } from "@/api/format";
import type { BaseItem } from "@/api/types";
import { desktop } from "@/platform/desktop";
import { sendPlayerCommand } from "./commands";

/**
 * Controls outside the page: the OS media keys and lock screen (Media Session) and,
 * in the desktop app, the tray's now-playing menu. Both drive the player through the
 * same commands as remote control.
 */
export function useOsControls(opts: {
  video: RefObject<HTMLVideoElement | null>;
  item: BaseItem | undefined;
  next: BaseItem | null;
  prev: BaseItem | null;
  duration: number;
  /** Re-sends the tray state when playback fails or recovers. */
  error: string | null;
}) {
  const { video, item, next, prev, duration, error } = opts;

  useEffect(() => {
    if (!item || !("mediaSession" in navigator)) return;
    const art = landscapeImage(item, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.Name,
      artist: item.SeriesName ?? "",
      album: item.Type === "Episode" ? episodeCode(item) : "",
      artwork: art ? [{ src: art.url, sizes: "512x288", type: "image/jpeg" }] : [],
    });
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    };
    set("play", () => sendPlayerCommand({ kind: "unpause" }));
    set("pause", () => sendPlayerCommand({ kind: "pause" }));
    set("seekbackward", () => sendPlayerCommand({ kind: "seekBy", seconds: -10 }));
    set("seekforward", () => sendPlayerCommand({ kind: "seekBy", seconds: 10 }));
    set("seekto", (d) => d.seekTime !== undefined && sendPlayerCommand({ kind: "seek", seconds: d.seekTime }));
    set("nexttrack", next ? () => sendPlayerCommand({ kind: "next" }) : null);
    set("previoustrack", prev ? () => sendPlayerCommand({ kind: "previous" }) : null);
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [item, next, prev]);

  // ---- desktop app: tray -----------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    if (!desktop || !item || !el) return;
    const send = () =>
      desktop?.setNowPlaying({
        title: item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name,
        subtitle: item.Type === "Episode" ? [episodeCode(item), item.Name].filter(Boolean).join(" — ") : item.ProductionYear?.toString(),
        paused: el.paused,
        position: el.currentTime,
        duration,
        hasNext: Boolean(next),
        hasPrevious: Boolean(prev),
      });
    send();
    // The tray shows play/pause state; plain progress doesn't need reporting.
    const events = ["play", "pause", "loadedmetadata"];
    events.forEach((e) => el.addEventListener(e, send));
    return () => events.forEach((e) => el.removeEventListener(e, send));
  }, [item, next, prev, duration, error, video]);
  useEffect(() => () => desktop?.setNowPlaying(null), []);
  useEffect(
    () =>
      desktop?.onPlayerCommand((command) => {
        sendPlayerCommand({ kind: command });
      }),
    [],
  );
}
