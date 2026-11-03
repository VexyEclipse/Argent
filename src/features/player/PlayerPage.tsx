import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type Hls from "hls.js";
import { getMediaSegments } from "@/api/jellyfin";
import { landscapeImage, logoImage } from "@/api/images";
import { episodeCode, formatClock, TICKS_PER_SECOND } from "@/api/format";
import type { BaseItem, MediaSegment } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { JellyfinMark } from "@/components/JellyfinLogo";
import { usePlatform } from "@/platform/platform";
import { isBackKey, moveFocus } from "@/platform/spatialNavigation";
import { QUALITY_OPTIONS } from "./deviceProfile";
import { episodeNeighbours, needsHlsJs, requestStream, resolvePlayable, streamsOfType, subtitleIsText, type StreamInfo, type StreamOptions } from "./playback";
import { PlayerMenu } from "./PlayerMenu";
import { PlaybackReporter } from "./reporter";
import { Seekbar } from "./Seekbar";
import "./player.css";

type Menu = "audio" | "subtitles" | "quality" | "speed" | "info" | null;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const VOLUME_KEY = "argent.volume";
const QUALITY_KEY = "argent.maxBitrate";
const HIDE_AFTER_MS = 3200;
const UP_NEXT_SECONDS = 30;

function readNumber(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

export default function PlayerPage() {
  const { id = "" } = useParams();
  // Remount per item so every title gets a clean session.
  return <Player key={id} id={id} />;
}

function Player({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const platform = usePlatform();
  const { user } = useAuth();
  const config = user?.Configuration;

  // Resolved once per mount: a background refetch would restart the stream.
  const resolved = useQuery({
    queryKey: ["play", id],
    queryFn: () => resolvePlayable(id),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });
  const item = resolved.data;
  const neighbours = useQuery({
    queryKey: ["play", "neighbours", item?.Id],
    queryFn: () => episodeNeighbours(item!),
    enabled: item?.Type === "Episode",
    staleTime: 60_000,
  });
  const segments = useQuery({
    queryKey: ["segments", item?.Id],
    queryFn: () =>
      getMediaSegments(item!.Id)
        .then((r) => r.Items)
        .catch(() => [] as MediaSegment[]),
    enabled: Boolean(item),
    staleTime: Infinity,
  });

  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [opts, setOpts] = useState<StreamOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => readNumber(VOLUME_KEY, 1));
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [subOffset, setSubOffset] = useState(0);
  const [cueHtml, setCueHtml] = useState<DocumentFragment[]>([]);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fellBack = useRef(false);
  const pendingSeek = useRef<number | null>(null);

  const duration = item?.RunTimeTicks ? item.RunTimeTicks / TICKS_PER_SECOND : video.current?.duration || 0;

  // ---- reporting ------------------------------------------------------------------
  const live = useRef({ current: 0, playing: false, muted: false, volume: 1, rate: 1 });
  live.current = { current, playing, muted, volume, rate };
  const reporter = useMemo(
    () =>
      new PlaybackReporter(() => ({
        positionSeconds: video.current?.currentTime ?? live.current.current,
        paused: !live.current.playing,
        muted: live.current.muted,
        volume: live.current.volume,
        playbackRate: live.current.rate,
      })),
    [],
  );

  useEffect(() => {
    const onHide = () => reporter.stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      reporter.stop().then(() => {
        // Resume points, Continue Watching and recommendations reflect this session.
        queryClient.invalidateQueries({ queryKey: ["home"] });
        queryClient.invalidateQueries({ queryKey: ["rec", "history"] });
        queryClient.invalidateQueries({ queryKey: ["item"] });
        queryClient.invalidateQueries({ queryKey: ["episodes"] });
        queryClient.invalidateQueries({ queryKey: ["nextup"] });
        queryClient.invalidateQueries({ queryKey: ["seasons"] });
      });
    };
  }, [reporter, queryClient]);

  // ---- initial stream -------------------------------------------------------------
  useEffect(() => {
    if (!item) return;
    const startParam = params.get("start");
    const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0;
    const pct = item.UserData?.PlayedPercentage ?? 0;
    const startTicks = startParam !== null ? Number(startParam) * TICKS_PER_SECOND : pct < 95 ? resumeTicks : 0;
    setOpts({ startTicks, maxBitrate: readNumber(QUALITY_KEY, QUALITY_OPTIONS[0].bitrate) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    if (!item || !opts) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    requestStream(item, opts)
      .then((s) => {
        if (cancelled) return;
        pendingSeek.current = opts.startTicks / TICKS_PER_SECOND;
        setStream(s);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Playback failed."));
    return () => {
      cancelled = true;
    };
  }, [item, opts]);

  /** Rebuild the stream (audio change, burned-in subtitle, quality) at the current position. */
  const reload = useCallback(
    (patch: Partial<StreamOptions>) => {
      const position = video.current?.currentTime ?? current;
      setOpts((o) => (o ? { ...o, ...patch, startTicks: Math.round(position * TICKS_PER_SECOND) } : o));
    },
    [current],
  );

  // ---- attach the source ----------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    if (!el || !stream || !item) return;
    let destroyed = false;
    const start = pendingSeek.current ?? 0;

    const attach = async () => {
      hls.current?.destroy();
      hls.current = null;
      if (stream.hls && needsHlsJs()) {
        const { default: HlsCtor } = await import("hls.js");
        if (destroyed) return;
        const h = new HlsCtor({
          startPosition: start,
          maxBufferLength: 30,
          maxMaxBufferLength: 120,
          backBufferLength: 60,
          manifestLoadingTimeOut: 20_000,
          fragLoadingTimeOut: 60_000,
        });
        hls.current = h;
        h.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
          else setError("The stream was interrupted. Check your connection to the server.");
        });
        h.loadSource(stream.url);
        h.attachMedia(el);
        pendingSeek.current = null;
      } else {
        el.src = stream.url;
      }
      el.volume = volume;
      el.playbackRate = rate;
      el.play().catch(() => setPlaying(false));
    };
    attach();

    reporter.start({
      itemId: item.Id,
      mediaSourceId: stream.source.Id,
      playSessionId: stream.playSessionId,
      method: stream.method,
      audioIndex: stream.audioIndex,
      subtitleIndex: stream.subtitleIndex,
      runtimeTicks: item.RunTimeTicks,
    });

    return () => {
      destroyed = true;
      hls.current?.destroy();
      hls.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // ---- video events ---------------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onMeta = () => {
      if (pendingSeek.current !== null) {
        if (pendingSeek.current > 0) el.currentTime = pendingSeek.current;
        pendingSeek.current = null;
      }
    };
    const onPlaying = () => {
      setLoading(false);
      setPlaying(true);
    };
    const onPause = () => {
      setPlaying(false);
      reporter.progress("Pause");
    };
    const onPlay = () => reporter.progress("Unpause");
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onTime = () => {
      setCurrent(el.currentTime);
      if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
    };
    const onSeeked = () => reporter.nudge("TimeUpdate");
    const onVolume = () => {
      setVolume(el.volume);
      setMuted(el.muted);
      store(VOLUME_KEY, el.volume);
      reporter.nudge("VolumeChange");
    };
    const onError = () => {
      // A file the browser claimed it could play but couldn't: ask the server to remux/transcode.
      if (stream?.method === "DirectPlay" && !fellBack.current) {
        fellBack.current = true;
        setToast("Switching to a compatible stream…");
        reload({ disableDirectPlay: true });
        return;
      }
      setError("This video couldn't be played on this device.");
    };
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("volumechange", onVolume);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("volumechange", onVolume);
      el.removeEventListener("error", onError);
    };
  }, [stream, reporter, reload]);

  // ---- subtitles (rendered by us for consistent styling and sync offset) ----------
  const textTrack = stream?.textTracks.find((t) => t.index === stream.subtitleIndex);
  useEffect(() => {
    const el = video.current;
    setCueHtml([]);
    if (!el || !textTrack) return;
    const tracks = Array.from(el.textTracks);
    const track = tracks.find((t) => t.label === textTrack.label && t.language === (textTrack.language ?? ""));
    tracks.forEach((t) => (t.mode = t === track ? "hidden" : "disabled"));
    if (!track) return;
    const onCue = () => {
      const cues = Array.from(track.activeCues ?? []) as VTTCue[];
      setCueHtml(cues.map((c) => c.getCueAsHTML()));
    };
    track.addEventListener("cuechange", onCue);
    return () => track.removeEventListener("cuechange", onCue);
  }, [textTrack, stream]);

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
  }, [subOffset, textTrack]);
  useEffect(() => {
    appliedOffset.current = 0;
    setSubOffset(0);
  }, [textTrack?.url]);

  // ---- controls visibility --------------------------------------------------------
  const hideTimer = useRef(0);
  const poke = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!video.current?.paused) setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    if (!playing || menu || scrubbing) {
      setVisible(true);
      window.clearTimeout(hideTimer.current);
    } else poke();
  }, [playing, menu, scrubbing, poke]);

  // ---- actions --------------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);
  const seekTo = useCallback((t: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, (el.duration || Infinity) - 0.5));
    setCurrent(el.currentTime);
  }, []);
  const seekBy = useCallback((d: number) => seekTo((video.current?.currentTime ?? 0) + d), [seekTo]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.current?.requestFullscreen?.().catch(() => {});
  }, []);
  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (window.history.length > 1) navigate(-1);
    else navigate(item ? `/details/${item.Type === "Episode" ? item.SeriesId : item.Id}` : "/", { replace: true });
  }, [navigate, item]);
  const playItem = useCallback((target: BaseItem | null | undefined) => target && navigate(`/play/${target.Id}?start=0`, { replace: true }), [navigate]);

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const selectSubtitle = (index: number) => {
    setMenu(null);
    if (!stream) return;
    const target = stream.source.MediaStreams.find((s) => s.Index === index);
    const currentlyBurned = stream.subtitleIndex !== undefined && stream.subtitleIndex >= 0 && !stream.textTracks.some((t) => t.index === stream.subtitleIndex);
    if (index === -1 || (target && subtitleIsText(target) && stream.textTracks.some((t) => t.index === index))) {
      if (currentlyBurned) reload({ subtitleIndex: index });
      else {
        setStream({ ...stream, subtitleIndex: index });
        reporter.updateStreams(stream.audioIndex, index);
      }
      return;
    }
    reload({ subtitleIndex: index }); // image/styled subtitles are burned in by the server
  };

  const selectAudio = (index: number) => {
    setMenu(null);
    if (stream && index !== stream.audioIndex) reload({ audioIndex: index, subtitleIndex: stream.subtitleIndex });
  };

  const selectQuality = (bitrate: number) => {
    setMenu(null);
    store(QUALITY_KEY, bitrate);
    reload({ maxBitrate: bitrate, audioIndex: stream?.audioIndex, subtitleIndex: stream?.subtitleIndex });
  };

  // ---- skip segments & up next ----------------------------------------------------
  const activeSegment = segments.data?.find(
    (s) =>
      ["Intro", "Recap", "Preview", "Commercial"].includes(s.Type) && current >= s.StartTicks / TICKS_PER_SECOND && current < s.EndTicks / TICKS_PER_SECOND - 1,
  );
  const outro = segments.data?.find((s) => s.Type === "Outro");
  const next = neighbours.data?.next ?? null;
  const prev = neighbours.data?.prev ?? null;
  const autoplay = config?.EnableNextEpisodeAutoPlay !== false;
  const upNextAt = outro ? outro.StartTicks / TICKS_PER_SECOND : duration - UP_NEXT_SECONDS;
  const showUpNext = Boolean(next && duration > 60 && current >= upNextAt && !upNextDismissed);

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
      playItem(next);
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, playing, next, playItem]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onEnded = () => {
      if (next && autoplay) playItem(next);
      else exit();
    };
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [next, autoplay, playItem, exit]);

  // ---- keyboard & remote ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return;
      if (isBackKey(e)) {
        e.preventDefault();
        if (menu) setMenu(null);
        else if (document.fullscreenElement && platform !== "tv") document.exitFullscreen();
        else exit();
        return;
      }
      const onControl = target.closest(".pc button, .seek, .pmenu");
      // With controls up on TV, the D-pad moves between controls.
      if (
        platform === "tv" &&
        visible &&
        onControl &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        !target.classList.contains("seek")
      ) {
        const dir = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowUp"];
        if (moveFocus(dir)) e.preventDefault();
        poke();
        return;
      }
      if (onControl && (e.key === "Enter" || e.key === " ")) {
        poke();
        return;
      }
      switch (e.key) {
        case " ":
        case "k":
        case "Enter":
        case "MediaPlayPause":
          togglePlay();
          break;
        case "MediaPlay":
          video.current?.play();
          break;
        case "MediaPause":
          video.current?.pause();
          break;
        case "ArrowLeft":
        case "j":
        case "MediaRewind":
          seekBy(-10);
          break;
        case "ArrowRight":
        case "l":
        case "MediaFastForward":
          seekBy(10);
          break;
        case "ArrowUp":
          if (platform === "tv") {
            poke();
            root.current?.querySelector<HTMLElement>(".pc__play")?.focus();
          } else if (video.current) video.current.volume = Math.min(1, video.current.volume + 0.05);
          break;
        case "ArrowDown":
          if (platform === "tv") {
            poke();
            root.current?.querySelector<HTMLElement>(".pc__play")?.focus();
          } else if (video.current) video.current.volume = Math.max(0, video.current.volume - 0.05);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          if (video.current) video.current.muted = !video.current.muted;
          break;
        case "c":
          if (stream) selectSubtitle(stream.subtitleIndex !== undefined && stream.subtitleIndex >= 0 ? -1 : (stream.textTracks[0]?.index ?? -1));
          break;
        case "N":
        case "MediaTrackNext":
          playItem(next);
          break;
        case "P":
        case "MediaTrackPrevious":
          playItem(prev);
          break;
        case "s":
          if (activeSegment) seekTo(activeSegment.EndTicks / TICKS_PER_SECOND);
          break;
        default:
          return;
      }
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- media session (OS / lock-screen controls) ------------------------------------
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
    set("play", () => video.current?.play());
    set("pause", () => video.current?.pause());
    set("seekbackward", () => seekBy(-10));
    set("seekforward", () => seekBy(10));
    set("seekto", (d) => d.seekTime !== undefined && seekTo(d.seekTime));
    set("nexttrack", next ? () => playItem(next) : null);
    set("previoustrack", prev ? () => playItem(prev) : null);
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [item, next, prev, seekBy, seekTo, playItem]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ---- touch: tap toggles controls, double-tap sides to seek ------------------------
  const lastTap = useRef(0);
  const onSurfaceClick = (e: React.MouseEvent) => {
    if (platform === "mobile") {
      const now = Date.now();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (now - lastTap.current < 300 && (x < 0.35 || x > 0.65)) {
        seekBy(x < 0.35 ? -10 : 10);
        setToast(x < 0.35 ? "−10 seconds" : "+10 seconds");
      } else if (visible) setVisible(false);
      else poke();
      lastTap.current = now;
      return;
    }
    togglePlay();
    poke();
  };

  // ---- render ---------------------------------------------------------------------
  const audioStreams = streamsOfType(stream?.source, "Audio");
  const subtitleStreams = streamsOfType(stream?.source, "Subtitle");
  const logo = item ? logoImage(item, 500) : null;
  const methodLabel = stream ? { DirectPlay: "Direct Play", DirectStream: "Direct Stream", Transcode: "Transcoding" }[stream.method] : "";
  const quality = readNumber(QUALITY_KEY, QUALITY_OPTIONS[0].bitrate);

  if (resolved.isError || error) {
    return (
      <div className="player player--error" ref={root}>
        <div className="player__message">
          <JellyfinMark size={44} />
          <h2>Playback unavailable</h2>
          <p>{error ?? (resolved.error instanceof Error ? resolved.error.message : "This item couldn't be loaded.")}</p>
          <div className="player__message-actions">
            <button className="btn btn--secondary btn--md" onClick={exit} data-autofocus autoFocus>
              Go back
            </button>
            {stream && (
              <button
                className="btn btn--primary btn--md"
                onClick={() => {
                  setError(null);
                  reload({ disableDirectPlay: true });
                }}
              >
                Try a compatible stream
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={root}
      className={`player ${visible ? "is-ui" : "is-idle"} ${playing ? "is-playing" : "is-paused"}`}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      data-nav-trap
      data-own-keys
    >
      <video
        ref={video}
        className="player__video"
        playsInline
        crossOrigin="anonymous"
        preload="auto"
        onClick={onSurfaceClick}
        onDoubleClick={() => platform === "desktop" && toggleFullscreen()}
      >
        {stream?.textTracks.map((t) => (
          <track key={`${stream.playSessionId}-${t.index}`} kind="subtitles" src={t.url} label={t.label} srcLang={t.language ?? ""} />
        ))}
      </video>

      {cueHtml.length > 0 && (
        <div className="player__cues" aria-live="off">
          {cueHtml.map((frag, i) => (
            <span
              key={i}
              className="player__cue"
              ref={(el) => {
                if (el) el.replaceChildren(frag.cloneNode(true));
              }}
            />
          ))}
        </div>
      )}

      {(loading || resolved.isPending) && (
        <div className="player__loading">
          {item && landscapeImage(item, 1280) && !playing && current === 0 ? (
            <div className="player__poster">
              <Artwork image={landscapeImage(item, 1280)} alt="" eager />
            </div>
          ) : null}
          <div className="spinner">
            <span />
          </div>
        </div>
      )}

      {/* ---- top bar ---- */}
      <div className="pc pc--top">
        <button className="pc__btn" onClick={exit} aria-label="Back">
          <Icon name="chevronLeft" size={26} />
        </button>
        <div className="pc__title">
          {item?.Type === "Episode" ? (
            <>
              <span className="pc__series">{item.SeriesName}</span>
              <span className="pc__episode">
                {episodeCode(item)} · {item.Name}
              </span>
            </>
          ) : logo ? (
            <img className="pc__logo" src={logo.url} alt={item?.Name} />
          ) : (
            <span className="pc__series">{item?.Name}</span>
          )}
        </div>
        <button
          className={`pc__btn pc__menu-trigger ${menu === "info" ? "is-active" : ""}`}
          onClick={() => setMenu(menu === "info" ? null : "info")}
          aria-label="Playback info"
        >
          <Icon name="info" size={22} />
        </button>
      </div>

      {activeSegment && (
        <button className="player__skip" onClick={() => seekTo(activeSegment.EndTicks / TICKS_PER_SECOND)} data-autofocus>
          Skip {activeSegment.Type === "Commercial" ? "Ad" : activeSegment.Type}
          <Icon name="skipNext" size={16} />
        </button>
      )}

      {showUpNext && next && (
        <div className="upnext fade-in" role="dialog" aria-label="Up next">
          <div className="upnext__thumb">
            <Artwork image={landscapeImage(next, 480)} alt="" />
          </div>
          <div className="upnext__text">
            <span className="eyebrow">Up next{countdown !== null ? ` · ${countdown}s` : ""}</span>
            <span className="upnext__title">{next.Name}</span>
            <span className="upnext__code">{episodeCode(next)}</span>
            <div className="upnext__actions">
              <button className="btn btn--primary btn--sm" onClick={() => playItem(next)} autoFocus>
                <Icon name="play" size={14} /> Play now
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setUpNextDismissed(true)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- bottom controls ---- */}
      <div className="pc pc--bottom">
        {item && (
          <Seekbar
            item={item}
            mediaSourceId={stream?.source.Id}
            current={current}
            duration={duration}
            buffered={buffered}
            onSeek={seekTo}
            onScrub={setScrubbing}
          />
        )}
        <div className="pc__row">
          <div className="pc__group">
            {prev && (
              <button className="pc__btn" onClick={() => playItem(prev)} aria-label="Previous episode" title="Previous episode (Shift+P)">
                <Icon name="skipPrev" size={22} />
              </button>
            )}
            <button className="pc__btn" onClick={() => seekBy(-10)} aria-label="Back 10 seconds" title="Back 10s (←)">
              <Icon name="replay10" size={26} />
            </button>
            <button
              className="pc__btn pc__play"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (Space)" : "Play (Space)"}
            >
              <Icon name={playing ? "pause" : "play"} size={30} />
            </button>
            <button className="pc__btn" onClick={() => seekBy(10)} aria-label="Forward 10 seconds" title="Forward 10s (→)">
              <Icon name="forward10" size={26} />
            </button>
            {next && (
              <button className="pc__btn" onClick={() => playItem(next)} aria-label="Next episode" title="Next episode (Shift+N)">
                <Icon name="skipNext" size={22} />
              </button>
            )}
            <div className="pc__volume">
              <button
                className="pc__btn"
                onClick={() => video.current && (video.current.muted = !video.current.muted)}
                aria-label={muted ? "Unmute" : "Mute"}
                title="Mute (M)"
              >
                <Icon name={muted || volume === 0 ? "volumeOff" : "volume"} size={22} />
              </button>
              <input
                className="pc__volume-range"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  if (!video.current) return;
                  video.current.volume = Number(e.target.value);
                  video.current.muted = false;
                }}
                aria-label="Volume"
                style={{ ["--fill" as string]: `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>
            <span className="pc__time">
              {formatClock(current)} <span className="pc__time-sep">/</span> {formatClock(duration)}
            </span>
          </div>

          <div className="pc__group pc__group--end">
            {subtitleStreams.length > 0 && (
              <button
                className={`pc__btn pc__menu-trigger ${menu === "subtitles" ? "is-active" : ""}`}
                onClick={() => setMenu(menu === "subtitles" ? null : "subtitles")}
                aria-label="Subtitles"
                title="Subtitles (C)"
              >
                <Icon name="subtitles" size={22} />
              </button>
            )}
            {audioStreams.length > 1 && (
              <button
                className={`pc__btn pc__menu-trigger ${menu === "audio" ? "is-active" : ""}`}
                onClick={() => setMenu(menu === "audio" ? null : "audio")}
                aria-label="Audio track"
                title="Audio"
              >
                <Icon name="audio" size={22} />
              </button>
            )}
            <button
              className={`pc__btn pc__menu-trigger ${menu === "speed" ? "is-active" : ""}`}
              onClick={() => setMenu(menu === "speed" ? null : "speed")}
              aria-label="Playback speed"
              title="Speed"
            >
              <Icon name="speed" size={22} />
            </button>
            <button
              className={`pc__btn pc__menu-trigger ${menu === "quality" ? "is-active" : ""}`}
              onClick={() => setMenu(menu === "quality" ? null : "quality")}
              aria-label="Quality"
              title="Quality"
            >
              <Icon name="sliders" size={22} />
            </button>
            {document.pictureInPictureEnabled && platform !== "tv" && (
              <button
                className="pc__btn"
                onClick={() => video.current?.requestPictureInPicture().catch(() => {})}
                aria-label="Picture in picture"
                title="Picture in picture"
              >
                <Icon name="pip" size={22} />
              </button>
            )}
            {platform !== "tv" && (
              <button className="pc__btn" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title="Full screen (F)">
                <Icon name={fullscreen ? "fullscreenExit" : "fullscreen"} size={22} />
              </button>
            )}
          </div>
        </div>

        {menu === "subtitles" && stream && (
          <PlayerMenu
            title="Subtitles"
            value={stream.subtitleIndex ?? -1}
            onChange={selectSubtitle}
            onClose={() => setMenu(null)}
            options={[
              { value: -1, label: "Off" },
              ...subtitleStreams.map((s) => ({
                value: s.Index,
                label: s.DisplayTitle || s.Language || `Track ${s.Index}`,
                detail: [s.IsForced && "Forced", s.IsExternal && "External", !subtitleIsText(s) && "Burned in"].filter(Boolean).join(" · ") || undefined,
              })),
            ]}
            footer={
              textTrack ? (
                <div className="pmenu__offset">
                  <span>Sync</span>
                  <button className="pc__btn pc__btn--sm" onClick={() => setSubOffset((o) => Math.round((o - 0.1) * 10) / 10)} aria-label="Subtitles earlier">
                    −
                  </button>
                  <span className="pmenu__offset-value">
                    {subOffset > 0 ? "+" : ""}
                    {subOffset.toFixed(1)}s
                  </span>
                  <button className="pc__btn pc__btn--sm" onClick={() => setSubOffset((o) => Math.round((o + 0.1) * 10) / 10)} aria-label="Subtitles later">
                    +
                  </button>
                  {subOffset !== 0 && (
                    <button className="pmenu__reset" onClick={() => setSubOffset(0)}>
                      Reset
                    </button>
                  )}
                </div>
              ) : stream.subtitleIndex !== undefined && stream.subtitleIndex >= 0 ? (
                <span className="pmenu__hint">Burned-in subtitles can't be re-timed.</span>
              ) : null
            }
          />
        )}
        {menu === "audio" && stream && (
          <PlayerMenu
            title="Audio"
            value={stream.audioIndex ?? -1}
            onChange={selectAudio}
            onClose={() => setMenu(null)}
            options={audioStreams.map((s) => ({
              value: s.Index,
              label: s.DisplayTitle || s.Language || `Track ${s.Index}`,
              detail: s.IsDefault ? "Default" : undefined,
            }))}
          />
        )}
        {menu === "speed" && (
          <PlayerMenu
            title="Speed"
            value={rate}
            onChange={(r) => {
              setRate(r);
              if (video.current) video.current.playbackRate = r;
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
            options={SPEEDS.map((s) => ({ value: s, label: s === 1 ? "Normal" : `${s}×` }))}
          />
        )}
        {menu === "quality" && (
          <PlayerMenu
            title="Quality"
            value={quality}
            onChange={selectQuality}
            onClose={() => setMenu(null)}
            options={QUALITY_OPTIONS.map((q) => ({
              value: q.bitrate,
              label: q.label,
              detail: q.bitrate === QUALITY_OPTIONS[0].bitrate ? "Direct play when possible" : undefined,
            }))}
          />
        )}
      </div>

      {menu === "info" && stream && (
        <div className="pinfo fade-in" role="dialog" aria-label="Playback info">
          <div className="pmenu__title">Playback</div>
          <dl>
            <div>
              <dt>Method</dt>
              <dd>{methodLabel}</dd>
            </div>
            {stream.transcodeReasons.length > 0 && (
              <div>
                <dt>Reason</dt>
                <dd>{stream.transcodeReasons.map((r) => r.replace(/([a-z])([A-Z])/g, "$1 $2")).join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>Container</dt>
              <dd>{stream.source.Container?.toUpperCase()}</dd>
            </div>
            {streamsOfType(stream.source, "Video")[0] && (
              <div>
                <dt>Video</dt>
                <dd>{streamsOfType(stream.source, "Video")[0].DisplayTitle}</dd>
              </div>
            )}
            {audioStreams.find((a) => a.Index === stream.audioIndex) && (
              <div>
                <dt>Audio</dt>
                <dd>{audioStreams.find((a) => a.Index === stream.audioIndex)!.DisplayTitle}</dd>
              </div>
            )}
            {stream.source.Bitrate && (
              <div>
                <dt>Bitrate</dt>
                <dd>{(stream.source.Bitrate / 1_000_000).toFixed(1)} Mbps</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
