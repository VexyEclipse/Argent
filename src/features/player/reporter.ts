import { pingPlayback, reportPlaybackProgress, reportPlaybackStart, reportPlaybackStopped, stopEncoding } from "@/api/jellyfin";
import type { PlayMethod } from "./streamPlan";

const TICKS = 10_000_000;

export interface ReportState {
  positionSeconds: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
}

interface Session {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  method: PlayMethod;
  audioIndex?: number;
  subtitleIndex?: number;
  runtimeTicks?: number;
}

/**
 * Keeps the server's view of this playback session current: start, periodic progress
 * (which also drives resume points and "Continue Watching"), and stop. Transcodes get a
 * keep-alive ping and are torn down on stop.
 */
export class PlaybackReporter {
  private session: Session | null = null;
  private timer = 0;
  private lastSent = 0;
  private read: () => ReportState;

  constructor(read: () => ReportState) {
    this.read = read;
  }

  private body(eventName?: string) {
    const s = this.session!;
    const state = this.read();
    return {
      ItemId: s.itemId,
      MediaSourceId: s.mediaSourceId,
      PlaySessionId: s.playSessionId,
      PlayMethod: s.method,
      AudioStreamIndex: s.audioIndex,
      SubtitleStreamIndex: s.subtitleIndex ?? -1,
      PositionTicks: Math.round(state.positionSeconds * TICKS),
      IsPaused: state.paused,
      IsMuted: state.muted,
      VolumeLevel: Math.round(state.volume * 100),
      PlaybackRate: state.playbackRate,
      CanSeek: true,
      RepeatMode: "RepeatNone",
      EventName: eventName,
    };
  }

  async start(session: Session) {
    if (this.session) await this.stop();
    this.session = session;
    try {
      await reportPlaybackStart(this.body());
    } catch {
      /* reporting must never break playback */
    }
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 10_000);
  }

  /**
   * Progress plus the transcode keep-alive, for a player outside the page that pushes
   * its state (a hidden page's own timers get throttled).
   */
  heartbeat() {
    window.clearInterval(this.timer);
    return this.tick();
  }

  private async tick() {
    if (!this.session) return;
    await this.progress("TimeUpdate");
    if (this.session?.method === "Transcode") pingPlayback(this.session.playSessionId).catch(() => {});
  }

  async progress(eventName?: string) {
    if (!this.session) return;
    this.lastSent = Date.now();
    try {
      await reportPlaybackProgress(this.body(eventName));
    } catch {
      /* ignore */
    }
  }

  /** Throttled progress for chatty events (seeks, volume). */
  nudge(eventName: string) {
    if (Date.now() - this.lastSent > 1500) this.progress(eventName);
  }

  updateStreams(audioIndex?: number, subtitleIndex?: number) {
    if (!this.session) return;
    this.session.audioIndex = audioIndex;
    this.session.subtitleIndex = subtitleIndex;
    this.progress("SubtitleTrackChange");
  }

  async stop() {
    const s = this.session;
    if (!s) return;
    window.clearInterval(this.timer);
    const body = this.body();
    this.session = null;
    try {
      await reportPlaybackStopped(body);
    } catch {
      /* ignore */
    }
    if (s.method !== "DirectPlay") stopEncoding(s.playSessionId).catch(() => {});
  }
}
