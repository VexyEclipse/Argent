import { useEffect, useMemo, useRef, useState } from "react";
import { backdropImage, logoImage } from "@/api/images";
import { client } from "@/api/jellyfin";
import { episodeCode } from "@/api/format";
import type { BaseItem, MediaSegment } from "@/api/types";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { logEvent } from "@/features/diagnostics/log";
import { usePlayerCommands } from "./commands";
import type { ExternalEngine } from "./external";
import { buildExternalRequest, indexOfOrdinal, type ExternalResult, type ExternalState } from "./externalPlan";
import { requestStream, type StreamInfo } from "./playback";
import { autoSkipNow, shouldAskStillWatching, upNextAt } from "./playerLogic";
import { readAutoSkip, readAutoplayChain, readQuality, readSound, writeAutoplayChain } from "./prefs";
import { QUALITY_OPTIONS } from "./deviceProfile";
import { PlaybackReporter } from "./reporter";

const TICKS = 10_000_000;

function authorise(url: string) {
  const c = client();
  const u = new URL(url.startsWith("http") ? url : `${c.serverUrl}${url}`);
  if (c.accessToken && !u.searchParams.has("ApiKey")) u.searchParams.set("ApiKey", c.accessToken);
  return u.toString();
}

/**
 * Plays a title in a player outside the page (the Android app's own player, or mpv) and
 * keeps the server informed from the state it reports. When it closes, Up Next and the
 * rating prompt carry on here as they would after the page's own player.
 */
export function ExternalPlayback(props: {
  engine: ExternalEngine;
  item: BaseItem;
  next: BaseItem | null;
  prev: BaseItem | null;
  segments: readonly MediaSegment[];
  startTicks: number;
  mediaSourceId?: string;
  audioIndex?: number;
  subtitleIndex?: number;
  autoplay: boolean;
  matchFrameRate: boolean;
  /** Called with the position when the player closes (for the rating prompt). */
  onPosition: (seconds: number) => void;
  /** The native player failed: play here instead, from this position. */
  onFallback: (seconds: number) => void;
  playItem: (item: BaseItem | null | undefined) => void;
  exit: () => void;
}) {
  const { engine, item } = props;
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stillWatching, setStillWatching] = useState(false);
  const state = useRef<ExternalState>({ position: props.startTicks / TICKS, paused: false });
  const latest = useRef(props);
  latest.current = props;

  const reporter = useMemo(
    () =>
      new PlaybackReporter(() => ({
        positionSeconds: state.current.position,
        paused: state.current.paused,
        muted: false,
        volume: 1,
        playbackRate: 1,
      })),
    [],
  );

  usePlayerCommands((c) => engine.control(c));

  useEffect(() => {
    let cancelled = false;
    const p = latest.current;
    const maxBitrate = readQuality(QUALITY_OPTIONS[0].bitrate);
    (async () => {
      const s = await requestStream(item, {
        startTicks: p.startTicks,
        maxBitrate,
        mediaSourceId: p.mediaSourceId,
        audioIndex: p.audioIndex,
        subtitleIndex: p.subtitleIndex,
        profile: engine.profile(maxBitrate),
      });
      if (cancelled) return;
      setStream(s);
      await reporter.start({
        itemId: item.Id,
        mediaSourceId: s.source.Id,
        playSessionId: s.playSessionId,
        method: s.method,
        audioIndex: s.audioIndex,
        subtitleIndex: s.subtitleIndex,
        runtimeTicks: item.RunTimeTicks,
      });
      reporter.heartbeat();
      const duration = (item.RunTimeTicks ?? 0) / TICKS;
      const request = buildExternalRequest({
        url: s.url,
        method: s.method,
        source: s.source,
        audioIndex: s.audioIndex,
        subtitleIndex: s.subtitleIndex,
        title: item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name,
        subtitle: item.Type === "Episode" ? `${episodeCode(item)} · ${item.Name}` : item.ProductionYear?.toString(),
        startSeconds: p.startTicks / TICKS,
        durationSeconds: duration,
        segments: p.segments,
        upNextAt: upNextAt(p.segments, duration),
        nextTitle: p.next ? `${episodeCode(p.next)} · ${p.next.Name}` : undefined,
        hasPrevious: Boolean(p.prev),
        matchFrameRate: p.matchFrameRate,
        sound: readSound(),
        authorise,
      });
      let lastBeat = Date.now();
      let wasPaused = false;
      // Automatic skips (Settings → Skipping), from the position the player reports.
      const autoSkip = readAutoSkip();
      const skipped = new Set<string>();
      let creditsSkipped = false;
      const result: ExternalResult = await engine.play(request, (st) => {
        state.current = st;
        const skip = autoSkipNow(p.segments, st.position, autoSkip, { hasNext: Boolean(p.next), done: skipped });
        if (skip) {
          skipped.add(skip.Id);
          if (skip.Type === "Outro") {
            creditsSkipped = true;
            engine.control({ kind: "next" });
          } else engine.control({ kind: "seek", seconds: skip.EndTicks / TICKS });
        }
        const audio = indexOfOrdinal(s.source, "Audio", st.audioOrdinal);
        const subtitle = st.externalSubtitle ?? indexOfOrdinal(s.source, "Subtitle", st.subtitleOrdinal);
        if ((audio !== undefined && audio !== s.audioIndex) || (subtitle !== undefined && subtitle !== s.subtitleIndex)) {
          s.audioIndex = audio ?? s.audioIndex;
          s.subtitleIndex = subtitle ?? s.subtitleIndex;
          reporter.updateStreams(s.audioIndex, s.subtitleIndex);
        }
        if (st.paused !== wasPaused) reporter.progress(st.paused ? "Pause" : "Unpause");
        else if (Date.now() - lastBeat > 9_000) {
          lastBeat = Date.now();
          reporter.heartbeat();
        }
        wasPaused = st.paused;
      });
      if (cancelled) return;
      state.current = result;
      await reporter.stop();
      logEvent("playback", `${engine.name} closed: ${result.reason}${result.error ? ` (${result.error})` : ""} at ${Math.round(result.position)}s`, result.reason === "error" ? "error" : "info");
      const now = latest.current;
      now.onPosition(result.position);
      if (result.interacted) writeAutoplayChain(0);
      switch (result.reason) {
        case "error":
          now.onFallback(result.position);
          return;
        case "next":
          // Skipping the credits on its own is autoplay, which stops to ask after a few episodes.
          if (creditsSkipped && !result.interacted && shouldAskStillWatching(readAutoplayChain())) {
            setStillWatching(true);
            return;
          }
          writeAutoplayChain(creditsSkipped && !result.interacted ? readAutoplayChain() + 1 : 0);
          now.playItem(now.next);
          return;
        case "previous":
          now.playItem(now.prev);
          return;
        case "ended":
          if (now.next && now.autoplay) {
            if (shouldAskStillWatching(readAutoplayChain())) {
              setStillWatching(true);
              return;
            }
            writeAutoplayChain(readAutoplayChain() + 1);
            now.playItem(now.next);
            return;
          }
          now.exit();
          return;
        default:
          now.exit();
      }
    })().catch((e) => {
      if (cancelled) return;
      const message = e instanceof Error ? e.message : "Playback failed.";
      logEvent("playback", `${engine.name}: ${message}`, "error");
      setError(message);
    });
    return () => {
      // Leaving the page (Back, another title) closes the other player too.
      if (!cancelled) engine.control({ kind: "stop" });
      cancelled = true;
      reporter.stop();
    };
    // One hand-off per mount; the player route remounts per title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backdrop = backdropImage(item, 1920);
  const running = Boolean(stream && !error && !stillWatching);
  const logo = logoImage(item, 500);

  return (
    <div className="player player--external" data-nav-trap>
      <div className="player__poster">{backdrop && <Artwork image={backdrop} alt="" eager />}</div>
      <div className="player__message">
        {logo ? <img className="pc__logo" src={logo.url} alt={item.Name} /> : <h2>{item.Name}</h2>}
        {error ? (
          <>
            <h2>Playback unavailable</h2>
            <p>{error}</p>
          </>
        ) : stillWatching && props.next ? (
          <>
            <h2>Are you still watching?</h2>
            <p>
              Next: {episodeCode(props.next)} · {props.next.Name}
            </p>
          </>
        ) : (
          <p>{stream ? `Playing in ${engine.name}` : "Starting…"}</p>
        )}
        <div className="player__message-actions">
          {stillWatching && props.next ? (
            <button
              className="btn btn--primary btn--md"
              autoFocus
              onClick={() => {
                writeAutoplayChain(0);
                props.playItem(props.next);
              }}
            >
              <Icon name="play" size={16} /> Keep watching
            </button>
          ) : (
            error && (
              <button className="btn btn--primary btn--md" autoFocus onClick={() => props.onFallback(props.startTicks / TICKS)}>
                Play here instead
              </button>
            )
          )}
          <button
            className="btn btn--secondary btn--md"
            onClick={running ? () => engine.control({ kind: "stop" }) : props.exit}
            data-autofocus={!error && !stillWatching ? true : undefined}
          >
            {running ? "Stop" : "Go back"}
          </button>
        </div>
      </div>
    </div>
  );
}
