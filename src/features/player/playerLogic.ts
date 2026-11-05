// Pure player rules: where playback starts, which subtitle changes need a new stream,
// skip and Up Next timing, and what a silent or blank stream means. Covered by
// playerLogic.test.ts; the player component only wires them to the video element.

import type { BaseItem, MediaSegment } from "@/api/types";

const TICKS = 10_000_000;

export const UP_NEXT_SECONDS = 30;
export const MAX_UNATTENDED_EPISODES = 3;
export const SKIPPABLE = ["Intro", "Recap", "Preview", "Commercial"] as const;

/** An explicit ?start= wins; otherwise resume, unless the title is basically finished. */
export function startTicks(item: Pick<BaseItem, "UserData">, startParam: string | null): number {
  if (startParam !== null && startParam !== "" && Number.isFinite(Number(startParam))) return Math.max(0, Number(startParam)) * TICKS;
  const resume = item.UserData?.PlaybackPositionTicks ?? 0;
  return (item.UserData?.PlayedPercentage ?? 0) < 95 ? resume : 0;
}

interface TrackState {
  subtitleIndex?: number;
  textTracks: { index: number }[];
  assTracks: { index: number }[];
}

const clientSide = (s: TrackState, index?: number) => s.textTracks.some((t) => t.index === index) || s.assTracks.some((t) => t.index === index);

/**
 * Switching to a subtitle this page draws itself is instant. Anything else (an image
 * subtitle, or leaving one that's burned in) needs the server to build a new stream.
 */
export function subtitleChange(state: TrackState, index: number): "local" | "reload" {
  const burned = state.subtitleIndex !== undefined && state.subtitleIndex >= 0 && !clientSide(state, state.subtitleIndex);
  if (index === -1 || clientSide(state, index)) return burned ? "reload" : "local";
  return "reload";
}

/** The C key: subtitles off when on, else the first text track. */
export function toggledSubtitle(state: TrackState): number {
  return state.subtitleIndex !== undefined && state.subtitleIndex >= 0 ? -1 : (state.textTracks[0]?.index ?? -1);
}

/** The intro, recap or ad being played, with a second's margin so the button doesn't flash at the end. */
export function activeSkip(segments: readonly MediaSegment[] | undefined, seconds: number): MediaSegment | undefined {
  return segments?.find(
    (s) => (SKIPPABLE as readonly string[]).includes(s.Type) && seconds >= s.StartTicks / TICKS && seconds < s.EndTicks / TICKS - 1,
  );
}

/**
 * Page Up: where the next chapter starts, or nothing at the last chapter or without any.
 * The second's margin keeps a seek that lands just short of a chapter from finding it again.
 */
export function nextChapter(chapters: BaseItem["Chapters"], seconds: number): number | undefined {
  return chapters
    ?.map((c) => c.StartPositionTicks / TICKS)
    .sort((a, b) => a - b)
    .find((t) => t > seconds + 1);
}

/** When Up Next appears: at the credits (outro segment), else 30 seconds from the end. */
export function upNextAt(segments: readonly MediaSegment[] | undefined, durationSeconds: number): number {
  const outro = segments?.find((s) => s.Type === "Outro");
  return outro ? outro.StartTicks / TICKS : durationSeconds - UP_NEXT_SECONDS;
}

export function outroStart(segments: readonly MediaSegment[] | undefined): number | undefined {
  const outro = segments?.find((s) => s.Type === "Outro");
  return outro ? outro.StartTicks / TICKS : undefined;
}

export interface DecodeReport {
  hasAudioTrack: boolean;
  /** Bytes of audio the browser decoded, where it reports that (Chromium); null elsewhere. */
  audioBytes: number | null;
  /** Firefox's own flag; null elsewhere. */
  mozHasAudio: boolean | null;
  /** Frames decoded, where trustworthy (Direct Play, page visible); null otherwise. */
  videoFrames: number | null;
}

/**
 * A browser can accept a file yet drop a track it can't decode, playing the picture in
 * silence (or the sound over black) without an error. Given a few seconds of playback,
 * says which one is missing.
 */
export function missingTrack(r: DecodeReport): "audio" | "picture" | null {
  if (r.hasAudioTrack && (r.audioBytes === 0 || r.mozHasAudio === false)) return "audio";
  if (r.videoFrames === 0) return "picture";
  return null;
}

/** Autoplay stops after a few unattended episodes and asks first. */
export const shouldAskStillWatching = (chain: number) => chain >= MAX_UNATTENDED_EPISODES;
