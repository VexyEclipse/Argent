import { useEffect, useRef, useState, type RefObject } from "react";
import { logEvent } from "@/features/diagnostics/log";
import { createAssRenderer, type AssRenderer } from "./assRenderer";
import type { StreamInfo, StreamOptions } from "./playback";

/**
 * Subtitles this page draws itself: WebVTT cues (rendered as HTML for consistent styling)
 * and ASS/SSA through libass, both with a sync offset. Burned-in subtitles are the
 * server's job and need nothing here.
 */
export function useSubtitles(opts: {
  video: RefObject<HTMLVideoElement | null>;
  stream: StreamInfo | null;
  /** In the iPhone's own full-screen player, which draws the chosen track itself. */
  nativeFullscreen: boolean;
  reload: (patch: Partial<StreamOptions>) => void;
  onNotice: (message: string) => void;
}) {
  const { video, stream, nativeFullscreen } = opts;
  const [subOffset, setSubOffset] = useState(0);
  const [cueHtml, setCueHtml] = useState<DocumentFragment[]>([]);
  const textTrack = stream?.textTracks.find((t) => t.index === stream.subtitleIndex);
  const assTrack = stream?.assTracks.find((t) => t.index === stream.subtitleIndex);

  // ---- WebVTT --------------------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    setCueHtml([]);
    if (!el || !textTrack) return;
    const tracks = Array.from(el.textTracks);
    const track = tracks.find((t) => t.label === textTrack.label && t.language === (textTrack.language ?? ""));
    tracks.forEach((t) => (t.mode = t === track ? (nativeFullscreen ? "showing" : "hidden") : "disabled"));
    if (!track) return;
    const onCue = () => {
      const cues = Array.from(track.activeCues ?? []) as VTTCue[];
      setCueHtml(cues.map((c) => c.getCueAsHTML()));
    };
    track.addEventListener("cuechange", onCue);
    return () => track.removeEventListener("cuechange", onCue);
  }, [textTrack, stream, nativeFullscreen, video]);

  // Shift every cue when the sync offset changes.
  const appliedOffset = useRef(0);
  useEffect(() => {
    const el = video.current;
    if (!el || !textTrack) return;
    const track = Array.from(el.textTracks).find((t) => t.label === textTrack.label);
    const delta = subOffset - appliedOffset.current;
    if (!track?.cues || !delta) return;
    for (const cue of Array.from(track.cues)) {
      cue.startTime = Math.max(0, cue.startTime + delta);
      cue.endTime = Math.max(0, cue.endTime + delta);
    }
    appliedOffset.current = subOffset;
  }, [subOffset, textTrack, video]);

  // ---- ASS/SSA (libass in the browser, keeps Direct Play) -------------------------
  const assCanvas = useRef<HTMLCanvasElement>(null);
  const assRenderer = useRef<AssRenderer | null>(null);
  const subOffsetRef = useRef(subOffset);
  subOffsetRef.current = subOffset;
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const el = video.current;
    const canvas = assCanvas.current;
    if (!el || !canvas || !assTrack || !stream) return;
    let cancelled = false;
    createAssRenderer({ video: el, canvas, subUrl: assTrack.url, fonts: stream.fonts, delay: subOffsetRef.current })
      .then((r) => {
        if (cancelled) r.destroy();
        else assRenderer.current = r;
      })
      .catch((e) => {
        if (cancelled) return;
        logEvent("subtitles", `ASS renderer unavailable (${e instanceof Error ? e.message : e}); burning in`, "warn");
        latest.current.onNotice("Switching to server-rendered subtitles…");
        latest.current.reload({ subtitleIndex: assTrack.index, burnInSubtitles: true });
      });
    return () => {
      cancelled = true;
      assRenderer.current?.destroy();
      assRenderer.current = null;
    };
    // A new renderer per track and per play session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assTrack?.url, stream?.playSessionId]);
  useEffect(() => {
    assRenderer.current?.setDelay(subOffset);
  }, [subOffset]);

  useEffect(() => {
    appliedOffset.current = 0;
    setSubOffset(0);
  }, [textTrack?.url, assTrack?.url]);

  return { cueHtml, subOffset, setSubOffset, textTrack, assTrack, assCanvas };
}
