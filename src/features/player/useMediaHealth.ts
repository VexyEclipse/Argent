import { useEffect, useRef, type RefObject } from "react";
import { logEvent } from "@/features/diagnostics/log";
import { isChromium, isFirefox } from "./deviceProfile";
import type { StreamInfo, StreamOptions } from "./playback";
import { streamsOfType } from "./playback";
import { missingTrack } from "./playerLogic";

/**
 * A few seconds into each play session, checks that both sound and picture are being
 * decoded, and otherwise asks the server for a stream that converts the missing one.
 */
export function useMediaHealth(opts: {
  video: RefObject<HTMLVideoElement | null>;
  stream: StreamInfo | null;
  streamOpts: StreamOptions | null;
  reload: (patch: Partial<StreamOptions>) => void;
  onNotice: (message: string) => void;
}) {
  const latest = useRef(opts);
  latest.current = opts;
  const { video, stream } = opts;

  useEffect(() => {
    const el = video.current;
    const { streamOpts } = latest.current;
    if (!el || !stream || !streamOpts) return;
    const hasAudioTrack = streamsOfType(stream.source, "Audio").length > 0;
    let played = 0;
    let last = el.currentTime;
    const check = () => {
      const step = el.currentTime - last;
      last = el.currentTime;
      // Count real playback only, not jumps to the resume point.
      if (el.paused || step <= 0 || step > 1) return;
      played += step;
      if (played < 4) return;
      el.removeEventListener("timeupdate", check);
      const media = el as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean };
      // Safari's native player always reports 0 decoded bytes, so only trust these where they're real.
      const missing = missingTrack({
        hasAudioTrack,
        audioBytes: isChromium && media.webkitAudioDecodedByteCount !== undefined ? media.webkitAudioDecodedByteCount : null,
        mozHasAudio: isFirefox && media.mozHasAudio !== undefined ? media.mozHasAudio : null,
        videoFrames:
          stream.method === "DirectPlay" && document.visibilityState === "visible" && el.getVideoPlaybackQuality
            ? el.getVideoPlaybackQuality().totalVideoFrames
            : null,
      });
      const { reload, onNotice } = latest.current;
      if (missing === "audio" && !streamOpts.compatibleAudio) {
        logEvent("playback", `No audio decoded from ${stream.method} ${stream.source.Container}; converting audio`, "warn");
        onNotice("No sound from this file. Switching to a compatible stream…");
        reload({ compatibleAudio: true, ...(stream.method === "DirectPlay" && { disableDirectPlay: true }) });
      } else if (missing === "picture" && !streamOpts.disableDirectPlay) {
        logEvent("playback", `No video frames from ${stream.source.Container}; falling back from Direct Play`, "warn");
        onNotice("No picture from this file. Switching to a compatible stream…");
        reload({ disableDirectPlay: true });
      }
    };
    el.addEventListener("timeupdate", check);
    return () => el.removeEventListener("timeupdate", check);
    // Once per play session; the options are the ones that session was built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.playSessionId]);
}
