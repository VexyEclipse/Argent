import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type Hls from "hls.js";
import { getEpisodes, getItem, getMediaSegments } from "@/api/jellyfin";
import { landscapeImage } from "@/api/images";
import { episodeCode, TICKS_PER_SECOND } from "@/api/format";
import { remotePlay, syncPlay } from "@/api/sessions";
import type { BaseItem, MediaSegment } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { JellyfinMark } from "@/components/JellyfinLogo";
import { showToast, ToastHost } from "@/components/Toast";
import { logEvent } from "@/features/diagnostics/log";
import { buildDiagnostics, copyText } from "@/features/diagnostics/report";
import { isFinished, ratingTarget, shouldPrompt } from "@/features/ratings/logic";
import { readRatingPrefs } from "@/features/ratings/prefs";
import { queueRatePrompt } from "@/features/ratings/prompt";
import { readRatings } from "@/features/ratings/store";
import { getTogether, setPlayTarget, useTogether } from "@/features/together/store";
import { useSyncPlayer, type SyncPlayer } from "@/features/together/useSyncPlayer";
import { usePlatform } from "@/platform/platform";
import { isBackKey, moveFocus } from "@/platform/spatialNavigation";
import { usePlayerCommands } from "./commands";
import { QUALITY_OPTIONS } from "./deviceProfile";
import { externalEngine, type ExternalEngine } from "./external";
import { ExternalPlayback } from "./ExternalPlayback";
import { episodeNeighbours, needsHlsJs, requestStream, resolvePlayable, type StreamInfo, type StreamOptions } from "./playback";
import { activeCredits, activeSkip, autoSkipNow, nextChapter, outroStart, skipLabel, startTicks, subtitleChange, toggledSubtitle } from "./playerLogic";
import { BottomBar, PlaybackInfo, TopBar, type Menu } from "./PlayerChrome";
import { readAutoSkip, readMatchFrameRate, readPauseInfo, readSound, saveSound, readQuality, readVolume, rememberedVersion, rememberVersion, saveQuality, saveVolume } from "./prefs";
import { useAudioEffects, type SoundPrefs } from "./audioEffects";
import { PauseInfo } from "./PauseInfo";
import { PlaybackReporter } from "./reporter";
import { useMediaHealth } from "./useMediaHealth";
import { useOsControls } from "./useOsControls";
import { shuffleEpisode } from "./shuffle";
import type { DownloadRecord } from "@/features/downloads/logic";
import { offlineNeighbours, offlineStart } from "@/features/downloads/logic";
import { OfflineReporter, offlineStream } from "@/features/downloads/offlinePlayback";
import { findDownload, readDownloads } from "@/features/downloads/store";
import { FillerBadge } from "@/features/filler/FillerBadge";
import { useEpisodeTitle } from "@/features/filler/names";
import { useFillerIds } from "@/features/filler/store";
import { useSubtitles } from "./useSubtitles";
import { useUpNext } from "./useUpNext";
import "./player.css";

type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const HIDE_AFTER_MS = 3200;
/** Paused and untouched this long: "You're watching" comes up. */
const PAUSE_INFO_AFTER_MS = 6000;

export default function PlayerPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { status } = useAuth();
  // A download plays from the device: asked for, or the only way while offline.
  if (params.has("offline") || status === "offline") return <OfflineRoute key={id} id={id} />;
  // Remount per title, per hand-off back from a native player and per group queue entry,
  // so each gets a clean session.
  return <PlayerRoute key={`${id}-${params.get("engine") ?? ""}-${params.get("together") ?? ""}`} id={id} />;
}

/** A downloaded title in the page's own player, with Up Next through the other downloaded episodes. */
function OfflineRoute({ id }: { id: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Read once: saving progress updates the record, which must not restart playback.
  const [record] = useState(() => findDownload(id));
  const [{ prev, next }] = useState(() => offlineNeighbours(readDownloads(), id));
  const position = useRef(0);
  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (window.history.length > 1) navigate(-1);
    else navigate("/downloads", { replace: true });
  }, [navigate]);
  const playItem = useCallback((target: BaseItem | null | undefined) => target && navigate(`/play/${target.Id}?offline=1&start=0`, { replace: true }), [navigate]);
  if (!record || record.state !== "done") return <PlaybackError message="This title isn't downloaded on this device." onBack={exit} />;
  const start = params.get("start") !== null ? startTicks(record.item, params.get("start")) : offlineStart(record);
  return (
    <WebPlayer item={record.item} next={next} prev={prev} segments={record.segments} startTicks={start} subtitleIndex={record.subtitleIndex} position={position} exit={exit} playItem={playItem} offline={record} />
  );
}

/**
 * Where a title plays: on the device chosen in "Play on", for the whole Watch Together
 * group, in the native player (Android app, mpv), or in this page's own player.
 */
function PlayerRoute({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const together = useTogether();
  const here = params.has("here") || params.has("together");

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
  // Shuffling a series: "next" is a random episode, and there's no "previous".
  const shuffle = params.get("shuffle");
  const neighbours = useQuery({
    queryKey: ["play", "neighbours", item?.Id, shuffle],
    queryFn: async () => (shuffle ? { prev: null, next: await shuffleEpisode(shuffle, item!.Id) } : episodeNeighbours(item!)),
    enabled: item?.Type === "Episode",
    staleTime: shuffle ? Infinity : 60_000,
  });
  // Whether the show is still airing: catching up on one isn't finishing it.
  const series = useQuery({
    queryKey: ["play", "series", item?.SeriesId],
    queryFn: () => getItem(item!.SeriesId!, []),
    enabled: item?.Type === "Episode" && Boolean(item.SeriesId),
    staleTime: 30 * 60_000,
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

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (window.history.length > 1) navigate(-1);
    else navigate(item ? `/details/${item.Type === "Episode" ? item.SeriesId : item.Id}` : "/", { replace: true });
  }, [navigate, item]);
  const playItem = useCallback(
    (target: BaseItem | null | undefined) => target && navigate(`/play/${target.Id}?start=0${shuffle ? `&shuffle=${shuffle}` : ""}`, { replace: true }),
    [navigate, shuffle],
  );

  // ---- where it plays ------------------------------------------------------------------
  type Route = { kind: "pending" } | { kind: "remote" } | { kind: "group"; failed?: boolean } | { kind: "external"; engine: ExternalEngine } | { kind: "web" };
  const [route, setRoute] = useState<Route>({ kind: "pending" });
  const start = item ? startTicks(item, params.get("start")) : 0;
  const version = params.get("version") ?? (item ? rememberedVersion(item.Id) : undefined);
  const inGroup = Boolean(together.group);
  useEffect(() => {
    if (!item || route.kind !== "pending") return;
    let cancelled = false;
    (async () => {
      const target = getTogether().target;
      if (target && !here) {
        await remotePlay(target.Id, [item.Id], start, version ?? undefined);
        logEvent("remote", `Sent ${item.Id} to ${target.DeviceName}`);
        if (!cancelled) navigate("/together", { replace: true });
        return;
      }
      if (inGroup && !here) {
        // Everyone in the group starts it; the queue update brings this device back here.
        const ids = item.Type === "Episode" && item.SeriesId ? await followingEpisodes(item) : [item.Id];
        await syncPlay.setQueue(ids, start);
        if (!cancelled) setRoute({ kind: "group" });
        window.setTimeout(() => !cancelled && setRoute((r) => (r.kind === "group" ? { kind: "group", failed: true } : r)), 10_000);
        return;
      }
      const engine = params.get("engine") === "web" || inGroup ? null : await externalEngine();
      if (!cancelled) setRoute(engine ? { kind: "external", engine } : { kind: "web" });
    })().catch((e) => {
      logEvent("playback", `Couldn't start: ${e instanceof Error ? e.message : e}`, "error");
      if (!cancelled) {
        if (getTogether().target && !here) {
          showToast("Couldn't reach that device. Playing here.");
          setPlayTarget(null);
        }
        setRoute({ kind: "web" });
      }
    });
    return () => {
      cancelled = true;
    };
    // Decided once, when the title has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  // ---- leaving: refresh what depends on watch state, and ask for a rating ---------------
  const position = useRef(start / TICKS_PER_SECOND);
  const duration = item?.RunTimeTicks ? item.RunTimeTicks / TICKS_PER_SECOND : 0;
  const rateCheck = useRef(() => {});
  rateCheck.current = () => {
    if (!item || !user || route.kind === "remote" || route.kind === "pending") return;
    // The last episode out only counts once we know whether more are coming.
    let next = neighbours.data ? neighbours.data.next : undefined;
    if (next === null && item.SeriesId && !series.isSuccess && !series.isError) next = undefined;
    const target = ratingTarget(item, next, { seasons: readRatingPrefs().rateSeasons, seriesStatus: series.data?.Status });
    if (isFinished(position.current, duration, outroStart(segments.data)) && shouldPrompt(target, readRatings(user.Id))) queueRatePrompt(target);
  };
  useEffect(
    () => () => {
      rateCheck.current();
      // Resume points, Continue Watching and recommendations reflect this session, once
      // the player's stop report has reached the server.
      window.setTimeout(() => {
        for (const key of ["home", "item", "episodes", "nextup", "seasons"]) queryClient.invalidateQueries({ queryKey: [key] });
        queryClient.invalidateQueries({ queryKey: ["rec", "history"] });
      }, 1200);
    },
    [queryClient],
  );

  const backdrop = item ? landscapeImage(item, 1280) : null;
  const waiting = (message: string, actions?: React.ReactNode) => (
    <div className="player player--external" data-nav-trap>
      {backdrop && (
        <div className="player__poster">
          <Artwork image={backdrop} alt="" eager />
        </div>
      )}
      <div className="player__message">
        <JellyfinMark size={44} />
        <p>{message}</p>
        <div className="player__message-actions">
          {actions}
          <button className="btn btn--secondary btn--md" onClick={exit} autoFocus>
            Go back
          </button>
        </div>
      </div>
    </div>
  );

  if (resolved.isError) return <PlaybackError message={resolved.error instanceof Error ? resolved.error.message : "This item couldn't be loaded."} onBack={exit} />;
  if (!item || route.kind === "pending") return waiting("Loading…");
  if (route.kind === "remote") return waiting(`Sending to ${together.target?.DeviceName ?? "the other device"}…`);
  if (route.kind === "group")
    return waiting(
      route.failed ? "The group didn't start it. Check that everyone can play this title." : `Starting for ${together.group?.GroupName ?? "the group"}…`,
      route.failed && (
        <button className="btn btn--primary btn--md" onClick={() => navigate(`/play/${item.Id}?start=${start / TICKS_PER_SECOND}&here=1`, { replace: true })}>
          Play just here
        </button>
      ),
    );
  if (route.kind === "external")
    return (
      <ExternalPlayback
        engine={route.engine}
        item={item}
        next={neighbours.data?.next ?? null}
        prev={neighbours.data?.prev ?? null}
        segments={segments.data ?? []}
        startTicks={start}
        mediaSourceId={version ?? undefined}
        audioIndex={numberParam(params.get("audio"))}
        subtitleIndex={numberParam(params.get("subtitle"))}
        autoplay={user?.Configuration?.EnableNextEpisodeAutoPlay !== false}
        matchFrameRate={readMatchFrameRate()}
        onPosition={(s) => (position.current = s)}
        onFallback={(s) => {
          showToast("Playing in Argent's own player instead");
          navigate(`/play/${item.Id}?start=${Math.floor(s)}&engine=web${version ? `&version=${version}` : ""}`, { replace: true });
        }}
        playItem={playItem}
        exit={exit}
      />
    );
  return (
    <WebPlayer
      item={item}
      next={neighbours.data?.next ?? null}
      prev={neighbours.data?.prev ?? null}
      segments={segments.data}
      startTicks={start}
      mediaSourceId={version ?? undefined}
      audioIndex={numberParam(params.get("audio"))}
      subtitleIndex={numberParam(params.get("subtitle"))}
      position={position}
      exit={exit}
      playItem={playItem}
    />
  );
}

const numberParam = (v: string | null) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** A group watching an episode carries on through the rest of the series. */
async function followingEpisodes(item: BaseItem): Promise<string[]> {
  const all = (await getEpisodes(item.SeriesId!)).Items.filter((e) => e.LocationType !== "Virtual");
  const i = all.findIndex((e) => e.Id === item.Id);
  return i < 0 ? [item.Id] : all.slice(i, i + 50).map((e) => e.Id);
}

function PlaybackError({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="player player--error">
      <div className="player__message">
        <JellyfinMark size={44} />
        <h2>Playback unavailable</h2>
        <p>{message}</p>
        <div className="player__message-actions">
          <button className="btn btn--secondary btn--md" onClick={onBack} data-autofocus autoFocus>
            Go back
          </button>
          {onRetry && (
            <button className="btn btn--primary btn--md" onClick={onRetry}>
              Try a compatible stream
            </button>
          )}
          <button
            className="btn btn--ghost btn--md"
            onClick={async () => setCopied(await copyText(await buildDiagnostics()))}
            title="For a bug report: what this device is and what the player did"
          >
            <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copied" : "Copy diagnostics"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- the page's own player ------------------------------------------------------------

function WebPlayer(props: {
  item: BaseItem;
  next: BaseItem | null;
  prev: BaseItem | null;
  segments: MediaSegment[] | undefined;
  startTicks: number;
  mediaSourceId?: string;
  audioIndex?: number;
  subtitleIndex?: number;
  /** Kept current for the rating prompt when the player closes. */
  position: React.MutableRefObject<number>;
  exit: () => void;
  playItem: (item: BaseItem | null | undefined) => void;
  /** Play this download from the device rather than streaming from the server. */
  offline?: DownloadRecord;
}) {
  const { item, next, prev, segments, exit } = props;
  const platform = usePlatform();
  const { user } = useAuth();

  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [opts, setOpts] = useState<StreamOptions>(() => ({
    startTicks: props.startTicks,
    maxBitrate: readQuality(QUALITY_OPTIONS[0].bitrate),
    mediaSourceId: props.mediaSourceId,
    audioIndex: props.audioIndex,
    subtitleIndex: props.subtitleIndex,
  }));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  /** In the iPhone's own full-screen player (see toggleFullscreen). */
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<Menu>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const fellBack = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const notice = useCallback((m: string) => showToast(m), []);

  const duration = item.RunTimeTicks ? item.RunTimeTicks / TICKS_PER_SECOND : video.current?.duration || 0;
  const sync: SyncPlayer | null = useSyncPlayer({ video, itemId: item.Id, onStop: exit });

  // ---- reporting ------------------------------------------------------------------
  const live = useRef({ current: 0, playing: false, muted: false, volume: 1, rate: 1 });
  // Until playback has actually reached the start point, the element reports 0:00.
  // Sending that would make Jellyfin wipe the resume point, so report the start point.
  const startSeconds = useRef(0);
  const reachedStart = useRef(false);
  live.current = { current, playing, muted, volume, rate };
  const positionNow = () => (reachedStart.current ? (video.current?.currentTime ?? live.current.current) : startSeconds.current);
  props.position.current = reachedStart.current ? current : Math.max(current, startSeconds.current);
  const reporter = useMemo(() => {
    const read = () => ({
      positionSeconds: positionNow(),
      paused: !live.current.playing,
      muted: live.current.muted,
      volume: live.current.volume,
      playbackRate: live.current.rate,
    });
    // A download keeps its own watch state, sent to the server once it's reachable.
    return props.offline ? new OfflineReporter(props.offline.id, read) : new PlaybackReporter(read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onHide = () => reporter.stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      reporter.stop();
    };
  }, [reporter]);

  // ---- stream ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (props.offline ? offlineStream(props.offline) : requestStream(item, opts))
      .then((s) => {
        if (cancelled) return;
        pendingSeek.current = opts.startTicks / TICKS_PER_SECOND;
        startSeconds.current = opts.startTicks / TICKS_PER_SECOND;
        reachedStart.current = false;
        setStream(s);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Playback failed."));
    return () => {
      cancelled = true;
    };
  }, [item, opts]);

  /** Rebuild the stream (audio change, burned-in subtitle, quality, version) at the current position. */
  const reload = useCallback(
    (patch: Partial<StreamOptions>) => {
      // Before the stream reaches its start point the element reads 0:00; keep the start.
      const position = reachedStart.current ? (video.current?.currentTime ?? current) : startSeconds.current;
      // Always restate both tracks: if either is left out, the server substitutes the
      // user's remembered track instead of the one playing now.
      const tracks = { audioIndex: stream?.audioIndex, subtitleIndex: stream?.subtitleIndex ?? -1, mediaSourceId: stream?.source.Id };
      setOpts((o) => ({ ...o, ...tracks, ...patch, startTicks: Math.round(position * TICKS_PER_SECOND) }));
    },
    [current, stream],
  );

  // ---- attach the source ----------------------------------------------------------
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
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
        let recoveries = 0;
        h.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (data.fatal || import.meta.env.DEV) logEvent("hls", `${data.type} ${data.details}${data.fatal ? " (fatal)" : ""} ${data.reason ?? data.error?.message ?? ""}`, data.fatal ? "error" : "warn");
          if (!data.fatal) return;
          // Recover a media error at most twice; looping recovery hammers the server.
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && recoveries++ < 2) h.recoverMediaError();
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
      // In a group, the group says when to start.
      if (!syncRef.current) el.play().catch(() => setPlaying(false));
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
    // Only a new play session needs a new source; switching a text subtitle must not
    // restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.playSessionId, stream?.url]);

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
      if (el.currentTime >= startSeconds.current - 5) reachedStart.current = true;
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
    const onSeeked = () => {
      // A completed seek (ours to the resume point, or the viewer's) means currentTime is real.
      if (el.currentTime > 1 || startSeconds.current < 1) reachedStart.current = true;
      reporter.nudge("TimeUpdate");
    };
    const onVolume = () => {
      setVolume(el.volume);
      setMuted(el.muted);
      saveVolume(el.volume);
      reporter.nudge("VolumeChange");
    };
    const onError = () => {
      const code = el.error?.code;
      // A file the browser claimed it could play but couldn't: ask the server to remux/transcode.
      if (stream?.method === "DirectPlay" && !fellBack.current) {
        fellBack.current = true;
        logEvent("playback", `Media error ${code ?? "?"} on Direct Play of ${stream.source.Container}; retrying without it`, "warn");
        notice("Switching to a compatible stream…");
        reload({ disableDirectPlay: true });
        return;
      }
      logEvent("playback", `Media error ${code ?? "?"} on ${stream?.method ?? "stream"}`, "error");
      setError("This video couldn't be played on this device.");
    };
    const events: [string, () => void][] = [
      ["loadedmetadata", onMeta],
      ["playing", onPlaying],
      ["pause", onPause],
      ["play", onPlay],
      ["waiting", onWaiting],
      ["canplay", onCanPlay],
      ["timeupdate", onTime],
      ["seeked", onSeeked],
      ["volumechange", onVolume],
      ["error", onError],
    ];
    events.forEach(([e, fn]) => el.addEventListener(e, fn));
    return () => events.forEach(([e, fn]) => el.removeEventListener(e, fn));
  }, [stream, reporter, reload, notice]);

  useMediaHealth({ video, stream, streamOpts: opts, reload, onNotice: notice });
  const [sound, setSound] = useState<SoundPrefs>(readSound);
  // Web Audio can't take the sound of a stream the browser plays natively (Safari, TVs).
  const soundSupported = !(stream?.hls && !needsHlsJs()) && typeof AudioContext !== "undefined";
  useAudioEffects(video, sound, soundSupported);
  const subs = useSubtitles({ video, stream, nativeFullscreen, reload, onNotice: notice });

  // ---- controls visibility --------------------------------------------------------
  const hideTimer = useRef(0);
  // Movement while paused restarts the wait for "You're watching" (and clears it).
  const [activity, setActivity] = useState(0);
  const poke = useCallback(() => {
    if (video.current?.paused) setActivity((a) => a + 1);
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

  const [pauseInfo, setPauseInfo] = useState(false);
  const pauseInfoOn = useMemo(readPauseInfo, []);
  useEffect(() => {
    setPauseInfo(false);
    if (playing || menu || scrubbing || loading || !pauseInfoOn) return;
    const t = window.setTimeout(() => {
      if (!video.current?.paused || !reachedStart.current) return;
      setPauseInfo(true);
      setVisible(false);
    }, PAUSE_INFO_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [playing, menu, scrubbing, loading, pauseInfoOn, activity]);

  // ---- actions (a Watch Together group decides play, pause and seek) ----------------
  const togglePlay = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (syncRef.current) syncRef.current.toggle();
    else if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);
  const seekTo = useCallback((t: number) => {
    const el = video.current;
    if (!el) return;
    const to = Math.max(0, Math.min(t, (el.duration || Infinity) - 0.5));
    if (syncRef.current) {
      syncRef.current.seek(to);
      return;
    }
    el.currentTime = to;
    setCurrent(el.currentTime);
  }, []);
  const seekBy = useCallback((d: number) => seekTo((video.current?.currentTime ?? 0) + d), [seekTo]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.fullscreenEnabled) root.current?.requestFullscreen?.().catch(() => {});
    // iPhone Safari can't put a page element full screen, only the video, in its own player.
    else (video.current as IosVideo | null)?.webkitEnterFullscreen?.();
  }, []);
  const goNext = useCallback(() => (syncRef.current?.hasNext ? syncRef.current.next() : props.playItem(next)), [next, props]);
  const goPrev = useCallback(() => (syncRef.current?.hasPrevious ? syncRef.current.previous() : props.playItem(prev)), [prev, props]);

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // The iPhone's own player draws subtitles itself, so the chosen track is shown while it's open.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const begin = () => setNativeFullscreen(true);
    const end = () => setNativeFullscreen(false);
    el.addEventListener("webkitbeginfullscreen", begin);
    el.addEventListener("webkitendfullscreen", end);
    return () => {
      el.removeEventListener("webkitbeginfullscreen", begin);
      el.removeEventListener("webkitendfullscreen", end);
    };
  }, []);

  const selectSubtitle = (index: number) => {
    setMenu(null);
    if (!stream) return;
    if (subtitleChange(stream, index) === "local") {
      setStream({ ...stream, subtitleIndex: index });
      reporter.updateStreams(stream.audioIndex, index);
    } else reload({ subtitleIndex: index }); // image/styled subtitles are burned in by the server
  };
  const selectAudio = (index: number) => {
    setMenu(null);
    if (stream && index !== stream.audioIndex) reload({ audioIndex: index, subtitleIndex: stream.subtitleIndex });
  };
  const selectQuality = (bitrate: number) => {
    setMenu(null);
    saveQuality(bitrate);
    reload({ maxBitrate: bitrate, audioIndex: stream?.audioIndex, subtitleIndex: stream?.subtitleIndex });
  };
  const selectVersion = (sourceId: string) => {
    setMenu(null);
    if (!stream || sourceId === stream.source.Id) return;
    rememberVersion(item.Id, sourceId);
    // Another file has its own tracks: let the server pick by language preference again.
    reload({ mediaSourceId: sourceId, audioIndex: undefined, subtitleIndex: undefined, disableDirectPlay: false, compatibleAudio: false });
  };

  // ---- commands: tray, media keys, remote control ------------------------------------
  usePlayerCommands((c) => {
    const el = video.current;
    if (!el) return;
    switch (c.kind) {
      case "toggle":
        togglePlay();
        break;
      case "pause":
        if (syncRef.current) syncRef.current.pause();
        else el.pause();
        break;
      case "unpause":
        if (syncRef.current) syncRef.current.unpause();
        else el.play().catch(() => {});
        break;
      case "stop":
        exit();
        break;
      case "next":
        goNext();
        break;
      case "previous":
        goPrev();
        break;
      case "seek":
        seekTo(c.seconds);
        break;
      case "seekBy":
        seekBy(c.seconds);
        break;
      case "volume":
        el.volume = Math.min(1, Math.max(0, c.value));
        el.muted = false;
        break;
      case "mute":
        el.muted = c.muted ?? !el.muted;
        break;
      case "audio":
        selectAudio(c.index);
        break;
      case "subtitle":
        selectSubtitle(c.index);
        break;
    }
    poke();
  });

  // ---- skip segments & up next ----------------------------------------------------
  const nextIsFiller = useFillerIds(next?.SeriesId).has(next?.Id ?? "");
  const nextTitle = useEpisodeTitle(next);
  const activeSegment = activeSkip(segments, current);
  const upNext = useUpNext({
    video,
    next: sync ? null : next,
    segments,
    current,
    duration,
    playing,
    autoplayEnabled: user?.Configuration?.EnableNextEpisodeAutoPlay !== false,
    playItem: props.playItem,
    exit,
  });
  // Skipping: intros and recaps get a card; the credits too, unless Up Next is up (with a
  // next episode, the Up Next card is the credits card). S does whichever is showing.
  const credits = activeCredits(segments, current);
  const skipCard = activeSegment ?? (credits && !(next && upNext.showUpNext && !sync) ? credits : undefined);
  const creditsToNext = Boolean(credits && next && !sync);
  const skipNow = useCallback(
    (segment: MediaSegment | undefined) => {
      if (segment?.Type === "Outro" && next && !syncRef.current) props.playItem(next);
      else if (segment) seekTo(segment.EndTicks / TICKS_PER_SECOND);
    },
    [next, props, seekTo],
  );
  // Automatic skips (Settings → Skipping). Not in a Watch Together group: everyone's
  // player would jump at once.
  const autoSkip = useMemo(readAutoSkip, []);
  const autoSkipped = useRef(new Set<string>());
  useEffect(() => {
    if (!playing || sync || !reachedStart.current) return;
    const segment = autoSkipNow(segments, current, autoSkip, { hasNext: Boolean(next), done: autoSkipped.current });
    if (!segment) return;
    autoSkipped.current.add(segment.Id);
    if (segment.Type === "Outro") {
      upNext.autoplayNext();
      return;
    }
    seekTo(segment.EndTicks / TICKS_PER_SECOND);
    showToast(`Skipped the ${segment.Type.toLowerCase()}`, { label: "Watch it", run: () => seekTo(segment.StartTicks / TICKS_PER_SECOND) });
  }, [current, playing, sync, segments, autoSkip, next, upNext, seekTo]);

  // A group moves on together when its episode ends.
  useEffect(() => {
    const el = video.current;
    if (!el || !sync) return;
    const onEnded = () => (sync.hasNext ? sync.next() : exit());
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [sync, exit]);

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
      if (platform === "tv" && visible && onControl && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !target.classList.contains("seek")) {
        const dir = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowUp"];
        if (moveFocus(dir)) e.preventDefault();
        poke();
        return;
      }
      // Enter activates the focused control; Space always means play/pause, so it can
      // never trigger whichever button was clicked last (e.g. "previous episode").
      if (onControl && e.key === "Enter") {
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
          if (syncRef.current) syncRef.current.unpause();
          else video.current?.play();
          break;
        case "MediaPause":
          if (syncRef.current) syncRef.current.pause();
          else video.current?.pause();
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
        case "ArrowDown":
          if (platform === "tv") {
            poke();
            root.current?.querySelector<HTMLElement>(".pc__play")?.focus();
          } else if (video.current) video.current.volume = Math.min(1, Math.max(0, video.current.volume + (e.key === "ArrowUp" ? 0.05 : -0.05)));
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          if (video.current) video.current.muted = !video.current.muted;
          break;
        case "c":
          if (stream) selectSubtitle(toggledSubtitle(stream));
          break;
        case "N":
        case "MediaTrackNext":
          goNext();
          break;
        case "P":
        case "MediaTrackPrevious":
          goPrev();
          break;
        case "s":
        case "S":
          // One key for every skip: the intro, the recap, the credits (to the next episode).
          if (skipCard) skipNow(skipCard);
          else if (creditsToNext || (upNext.showUpNext && next && !sync)) props.playItem(next);
          else return;
          break;
        case "PageUp": {
          const chapter = nextChapter(item.Chapters, video.current?.currentTime ?? 0);
          if (chapter === undefined) return;
          seekTo(chapter);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useOsControls({ video, item, next, prev, duration, error });

  // Mouse clicks shouldn't leave a button focused for the keyboard shortcuts to hit.
  // Remote and keyboard users keep focus where they put it.
  const releaseFocus = (e: React.MouseEvent) => {
    if (platform === "tv") return;
    const button = (e.target as HTMLElement).closest("button");
    if (button && !button.closest(".pmenu")) button.blur();
  };

  // ---- touch: tap toggles controls, double-tap sides to seek ------------------------
  const lastTap = useRef(0);
  const onSurfaceClick = (e: React.MouseEvent) => {
    if (platform === "mobile") {
      const now = Date.now();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (now - lastTap.current < 300 && (x < 0.35 || x > 0.65)) {
        seekBy(x < 0.35 ? -10 : 10);
        notice(x < 0.35 ? "−10 seconds" : "+10 seconds");
      } else if (visible) setVisible(false);
      else poke();
      lastTap.current = now;
      return;
    }
    togglePlay();
    poke();
  };

  const copyDiagnostics = async () => {
    setMenu(null);
    notice((await copyText(await buildDiagnostics())) ? "Diagnostics copied" : "Couldn't copy here");
  };

  if (error) {
    return (
      <PlaybackError
        message={error}
        onBack={exit}
        onRetry={
          stream
            ? () => {
                setError(null);
                reload({ disableDirectPlay: true });
              }
            : undefined
        }
      />
    );
  }

  return (
    <div
      ref={root}
      className={`player ${visible ? "is-ui" : "is-idle"} ${playing ? "is-playing" : "is-paused"} ${nativeFullscreen ? "is-native-fs" : ""}`}
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

      {subs.assTrack && stream && <canvas key={`${stream.playSessionId}-${subs.assTrack.index}`} ref={subs.assCanvas} className="player__ass" aria-hidden="true" />}

      {subs.cueHtml.length > 0 && (
        <div className="player__cues" aria-live="off">
          {subs.cueHtml.map((frag, i) => (
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

      {pauseInfo && !upNext.stillWatching && <PauseInfo item={item} />}

      {loading && (
        <div className="player__loading">
          {landscapeImage(item, 1280) && !playing && current === 0 ? (
            <div className="player__poster">
              <Artwork image={landscapeImage(item, 1280)} alt="" eager />
            </div>
          ) : null}
          <div className="spinner">
            <span />
          </div>
        </div>
      )}

      <TopBar
        item={item}
        menu={menu}
        setMenu={setMenu}
        onBack={exit}
        onMouseUp={releaseFocus}
        badge={
          sync && (
            <span className="pc__together" title={sync.group.Participants.join(", ")}>
              <Icon name="users" size={16} /> {sync.group.GroupName} · {sync.group.Participants.length}
            </span>
          )
        }
      />

      {skipCard && !upNext.stillWatching && (
        <SkipCard
          key={skipCard.Id}
          label={skipLabel(skipCard.Type)}
          progress={(current - skipCard.StartTicks / TICKS_PER_SECOND) / ((skipCard.EndTicks - skipCard.StartTicks) / TICKS_PER_SECOND)}
          keyHint={platform === "desktop"}
          onSkip={() => skipNow(skipCard)}
        />
      )}

      {upNext.stillWatching && next && (
        <div className="upnext upnext--still fade-in" role="dialog" aria-label="Still watching?">
          <div className="upnext__text">
            <span className="eyebrow">Paused</span>
            <span className="upnext__title">Are you still watching?</span>
            <span className="upnext__code">
              Next: {episodeCode(next)} · {nextTitle}
            </span>
            <div className="upnext__actions">
              <button className="btn btn--primary btn--sm" autoFocus onClick={upNext.keepWatching}>
                <Icon name="play" size={14} /> Keep watching
              </button>
              <button className="btn btn--ghost btn--sm" onClick={exit}>
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      {upNext.showUpNext && next && !upNext.stillWatching && (
        <div className="upnext fade-in" role="dialog" aria-label="Up next">
          <div className="upnext__thumb">
            <Artwork image={landscapeImage(next, 480)} alt="" />
          </div>
          <div className="upnext__text">
            <span className="eyebrow">Up next{upNext.countdown !== null ? ` · ${upNext.countdown}s` : ""}</span>
            <span className="upnext__title">{nextTitle}</span>
            <span className="upnext__code">
              {episodeCode(next)}
              {nextIsFiller && <FillerBadge />}
            </span>
            <div className="upnext__actions">
              <button className="btn btn--primary btn--sm" onClick={() => props.playItem(next)} autoFocus>
                <Icon name="play" size={14} /> Next episode
                {platform === "desktop" && <kbd className="kbd">S</kbd>}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={upNext.dismiss}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomBar
        item={item}
        stream={stream}
        platform={platform}
        menu={menu}
        setMenu={setMenu}
        current={current}
        duration={duration}
        buffered={buffered}
        playing={playing}
        volume={volume}
        muted={muted}
        rate={rate}
        quality={readQuality(QUALITY_OPTIONS[0].bitrate)}
        fullscreen={fullscreen}
        hasPrev={Boolean(sync ? sync.hasPrevious : prev)}
        hasNext={Boolean(sync ? sync.hasNext : next)}
        subOffset={subs.subOffset}
        setSubOffset={subs.setSubOffset}
        subtitlesAdjustable={Boolean(subs.textTrack || subs.assTrack)}
        onMouseUp={releaseFocus}
        onSeek={seekTo}
        onScrub={setScrubbing}
        onSeekBy={seekBy}
        onTogglePlay={togglePlay}
        onPrev={goPrev}
        onNext={goNext}
        onToggleMute={() => video.current && (video.current.muted = !video.current.muted)}
        onVolume={(v) => {
          if (!video.current) return;
          video.current.volume = v;
          video.current.muted = false;
        }}
        onSubtitle={selectSubtitle}
        onAudio={selectAudio}
        onSpeed={(r) => {
          setRate(r);
          if (video.current) video.current.playbackRate = r;
          setMenu(null);
        }}
        onQuality={selectQuality}
        onVersion={selectVersion}
        sound={sound}
        soundSupported={soundSupported}
        onSound={(patch) =>
          setSound((s) => {
            const next = { ...s, ...patch };
            saveSound(next);
            return next;
          })
        }
        onPip={document.pictureInPictureEnabled && platform !== "tv" ? () => video.current?.requestPictureInPicture().catch(() => {}) : undefined}
        onFullscreen={toggleFullscreen}
      />

      {menu === "info" && stream && <PlaybackInfo stream={stream} onCopyDiagnostics={copyDiagnostics} />}

      <ToastHost />
    </div>
  );
}

/**
 * The skip card: appears as an intro, recap or the credits start, fills as the part plays
 * out, and takes focus so OK on a remote presses it.
 */
function SkipCard({ label, progress, keyHint, onSkip }: { label: string; progress: number; keyHint: boolean; onSkip: () => void }) {
  return (
    <button className="player__skip fade-in" onClick={onSkip} data-autofocus>
      <span className="player__skip-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} aria-hidden="true" />
      <span className="player__skip-label">{label}</span>
      <Icon name="skipNext" size={16} />
      {keyHint && <kbd className="kbd">S</kbd>}
    </button>
  );
}
