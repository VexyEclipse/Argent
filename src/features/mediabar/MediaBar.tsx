import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type TouchEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setFavorite } from "@/api/jellyfin";
import { backdropImage } from "@/api/images";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Icon } from "@/components/Icon";
import { usePlatform } from "@/platform/platform";
import { Countdown } from "./Countdown";
import { loadMediaBar, persistIndex } from "./data";
import { activeDot, selectTrailerVideoId } from "./logic";
import { Slide } from "./Slide";
import { SettingsPanel } from "./SettingsPanel";
import { createLocalPlayer, createYouTubePlayer, localTrailerUrl, sponsorBlockStart, type TrailerPlayer } from "./trailers";
import { useMediaBarConfig } from "./useMediaBarConfig";
import "./mediabar.css";

interface Props {
  /** Called with the active slide's backdrop when syncPageBackdrop is on. */
  onBackdropChange?: (url: string | null) => void;
}

function useViewportWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function isDataSaverOn(respect: boolean) {
  if (!respect) return false;
  try {
    return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  } catch {
    return false;
  }
}

export function MediaBar({ onBackdropChange }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const platform = usePlatform();
  const mb = useMediaBarConfig();
  const { config } = mb;
  const width = useViewportWidth();
  const touchLayout = platform === "mobile" || width <= config.touchLayoutMaxWidth;

  // Data reloads only when settings that change *which* items load are changed.
  const dataKey = useMemo(
    () => [config.libraries, config.trailerLibraries, config.maxItems, config.maxMovies, config.maxSeries, config.rememberOrderForSession],
    [config.libraries, config.trailerLibraries, config.maxItems, config.maxMovies, config.maxSeries, config.rememberOrderForSession],
  );
  const { data, isPending, isError } = useQuery({
    queryKey: ["mediabar", "items", user?.Id, dataKey],
    queryFn: () => loadMediaBar(config),
    enabled: mb.ready,
    staleTime: 30 * 60_000,
  });

  const items = data?.items ?? [];
  const total = items.length;
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [hoverHeld, setHoverHeld] = useState(false);
  const [inView, setInView] = useState(true);
  const [docVisible, setDocVisible] = useState(!document.hidden);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const transitioning = useRef(false);

  const root = useRef<HTMLDivElement>(null);
  const trailerHost = useRef<HTMLDivElement | null>(null);
  const player = useRef<TrailerPlayer | null>(null);

  const visible = inView && docVisible;
  const running = total > 1 && !paused && !hoverHeld && !settingsOpen && visible && !videoPlaying;

  // Start from the remembered position once data arrives.
  useEffect(() => {
    if (data) setIndex(Math.min(data.startIndex, Math.max(0, data.items.length - 1)));
  }, [data]);

  const goTo = useCallback(
    (next: number) => {
      if (!total || transitioning.current) return;
      const target = ((next % total) + total) % total;
      if (target === index) return;
      transitioning.current = true;
      setPrevious(index);
      setIndex(target);
      setVideoPlaying(false);
      window.setTimeout(() => {
        transitioning.current = false;
        setPrevious(null);
      }, config.fadeTransitionDuration);
    },
    [total, index, config.fadeTransitionDuration],
  );

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // ---- rotation timer ---------------------------------------------------------------
  const nextRef = useRef(next);
  nextRef.current = next;
  const countdown = useMemo(() => new Countdown(() => nextRef.current()), []);

  useEffect(() => {
    countdown.reset(config.shuffleInterval);
    setCycle((c) => c + 1);
  }, [index, config.shuffleInterval, countdown]);

  useEffect(() => {
    if (running) countdown.resume();
    else if (videoPlaying) countdown.stop();
    else countdown.pause();
  }, [running, videoPlaying, index, cycle, countdown]);

  useEffect(() => () => countdown.stop(), [countdown]);

  useEffect(() => {
    if (data && config.rememberOrderForSession) persistIndex(index, config);
  }, [index, data, config]);

  // ---- focus across slides ----------------------------------------------------------
  // The outgoing slide goes inert, which drops focus from its buttons. With a remote that
  // strands you on the page, so the same button on the incoming slide takes focus over.
  const focusedAction = useRef<number | null>(null);
  const onFocusIn = (e: FocusEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest(".mb-actions");
    focusedAction.current = row ? [...row.children].indexOf(e.target as HTMLElement) : null;
  };
  const onFocusOut = (e: FocusEvent<HTMLElement>) => {
    // Inert removes focus with no new target; anything else is the user moving on.
    if (e.relatedTarget) focusedAction.current = null;
  };
  useLayoutEffect(() => {
    const at = focusedAction.current;
    const active = document.activeElement;
    const stranded = !active || active === document.body || active.closest(".mb-slide:not(.is-active)");
    if (at === null || !stranded) return;
    const button = root.current?.querySelectorAll<HTMLElement>(".mb-slide.is-active .mb-actions > *")[at];
    button?.focus({ preventScroll: true });
  }, [index]);

  // ---- visibility -------------------------------------------------------------------
  useEffect(() => {
    const onVis = () => setDocVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio > 0.35), { threshold: [0, 0.35, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [total]);

  // ---- preloading -------------------------------------------------------------------
  useEffect(() => {
    if (!total) return;
    const wanted = [index + 1];
    if (config.preloadCount > 1) wanted.push(index - 1);
    for (let k = 2; k <= config.preloadCount - 1; k++) wanted.push(index + k);
    for (const i of wanted) {
      const item = items[((i % total) + total) % total];
      const url = item && backdropImage(item, 1920)?.url;
      if (url) new Image().src = url;
    }
  }, [index, total, items, config.preloadCount]);

  // ---- page backdrop sync -----------------------------------------------------------
  const current: BaseItem | undefined = items[index];
  useEffect(() => {
    if (!onBackdropChange) return;
    if (!config.syncPageBackdrop || !current) onBackdropChange(null);
    else onBackdropChange(backdropImage(current, 1280)?.url ?? null);
  }, [current, config.syncPageBackdrop, onBackdropChange]);
  useEffect(() => () => onBackdropChange?.(null), [onBackdropChange]);

  // ---- trailers ---------------------------------------------------------------------
  const trailerSource = useMemo(() => {
    if (!current) return null;
    if (!config.enableTrailers) return null;
    if (touchLayout && !config.allowTrailersOnTouch) return null;
    if (isDataSaverOn(config.respectDataSaver)) return null;
    const libraryId = (current as BaseItem & { LibraryId?: string }).LibraryId;
    if (data?.trailerLibraryIds.size && libraryId && !data.trailerLibraryIds.has(libraryId)) return null;
    if (config.preferLocalTrailers && (current.LocalTrailerCount ?? 0) > 0) return { kind: "local" as const };
    const id = selectTrailerVideoId(current.RemoteTrailers, config.trailerAlternateCutTerms);
    return id ? { kind: "youtube" as const, id } : null;
  }, [current, config, touchLayout, data]);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const stateRef = useRef({ paused, hoverHeld, visible });
  stateRef.current = { paused, hoverHeld, visible };

  // Build the player when the slide becomes active; start it after the delay.
  useEffect(() => {
    const host = trailerHost.current;
    if (!trailerSource || !current || !host) return;
    let cancelled = false;
    let startTimer = 0;
    let watchdog = 0;
    const itemId = current.Id;

    const resumeTimer = () => {
      if (cancelled) return;
      setVideoPlaying(false);
      countdown.reset(config.shuffleInterval);
      setCycle((c) => c + 1);
    };
    const callbacks = {
      onPlaying: () => {
        if (cancelled) return;
        window.clearTimeout(watchdog);
        setVideoPlaying(true);
      },
      onEnded: () => {
        if (cancelled) return;
        setVideoPlaying(false);
        nextRef.current();
      },
      onPaused: () => {
        if (!cancelled && !stateRef.current.paused) resumeTimer();
      },
      onError: () => {
        console.warn(`MediaBar: trailer for ${itemId} failed; continuing without it.`);
        window.clearTimeout(watchdog);
        resumeTimer();
      },
    };

    (async () => {
      let p: TrailerPlayer | null = null;
      if (trailerSource.kind === "local") {
        const url = await localTrailerUrl(itemId);
        if (cancelled || !url) return;
        const video = document.createElement("video");
        video.className = "mb-trailer__video";
        video.src = url;
        host.appendChild(video);
        p = createLocalPlayer(video, callbacks);
      } else {
        const start = config.enableSponsorBlock ? await sponsorBlockStart(trailerSource.id) : 0;
        if (cancelled) return;
        p = await createYouTubePlayer(
          host,
          trailerSource.id,
          { captions: config.trailerCaptions, start, apiTimeoutMs: config.youtubeApiLoadTimeoutMs },
          callbacks,
        );
      }
      if (cancelled) {
        p?.destroy();
        return;
      }
      player.current = p;
      if (!p) return;
      startTimer = window.setTimeout(() => {
        const s = stateRef.current;
        if (cancelled || s.paused || s.hoverHeld || !s.visible) return;
        p!.setMuted(mutedRef.current, config.trailerVolume);
        p!.seekTo(0);
        p!.play();
        watchdog = window.setTimeout(() => {
          console.warn(`MediaBar: trailer for ${itemId} did not start within ${config.trailerPlaybackWatchdogMs}ms.`);
          callbacks.onError();
        }, config.trailerPlaybackWatchdogMs);
      }, config.trailerStartDelayMs);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(watchdog);
      player.current?.destroy();
      player.current = null;
      setVideoPlaying(false);
      host.replaceChildren();
    };
    // Rebuild only when the slide or trailer source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.Id, trailerSource?.kind, trailerSource && "id" in trailerSource ? trailerSource.id : null]);

  // Pausing the bar (button, hover, scrolled away) pauses a playing trailer too.
  useEffect(() => {
    const p = player.current;
    if (!p || !videoPlaying) return;
    if (paused || !visible) p.pause();
  }, [paused, visible, videoPlaying]);

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    player.current?.setMuted(nextMuted, config.trailerVolume);
  };

  const togglePause = () => {
    setPaused((p) => {
      const nextPaused = !p;
      if (!nextPaused && player.current && trailerSource) player.current.play();
      return nextPaused;
    });
  };

  // ---- actions ----------------------------------------------------------------------
  const isFavorite = (item: BaseItem) => favorites[item.Id] ?? Boolean(item.UserData?.IsFavorite);
  const toggleFavorite = async (item: BaseItem) => {
    const nextValue = !isFavorite(item);
    setFavorites((f) => ({ ...f, [item.Id]: nextValue }));
    try {
      await setFavorite(item.Id, nextValue);
      queryClient.invalidateQueries({ queryKey: ["item", item.Id] });
    } catch {
      setFavorites((f) => ({ ...f, [item.Id]: !nextValue }));
    }
  };

  // ---- input ------------------------------------------------------------------------
  const touchStart = useRef(0);
  const onTouchStart = (e: TouchEvent) => (touchStart.current = e.changedTouches[0].screenX);
  const onTouchEnd = (e: TouchEvent) => {
    const diff = e.changedTouches[0].screenX - touchStart.current;
    if (Math.abs(diff) < config.minSwipeDistance) return;
    if (diff > 0) prev();
    else next();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.closest(".mb-settings"))) return;
    const buttonRow = root.current?.querySelector(".mb-slide.is-active .mb-actions");
    const focusedButton = buttonRow && active && buttonRow.contains(active) ? active : null;
    switch (e.key) {
      case "ArrowRight": {
        const sibling = focusedButton?.nextElementSibling as HTMLElement | null;
        if (sibling) sibling.focus();
        else next();
        e.preventDefault();
        break;
      }
      case "ArrowLeft": {
        const sibling = focusedButton?.previousElementSibling as HTMLElement | null;
        if (sibling) sibling.focus();
        else prev();
        e.preventDefault();
        break;
      }
      case " ":
        if (!focusedButton) {
          togglePause();
          e.preventDefault();
        }
        break;
      case "Enter":
        if (!focusedButton && active === root.current && current) {
          navigate(`/play/${current.Id}`);
          e.preventDefault();
        }
        break;
      case "Escape":
        root.current?.blur();
        break;
    }
  };

  // ---- render -----------------------------------------------------------------------
  if (isError || (data && !total)) return null; // Nothing to feature: the home rows take over.

  if (isPending || !data) {
    return (
      <div className={`mediabar mediabar--${config.layout} is-loading`} aria-busy="true">
        <div className="mb-skeleton">
          <div className="skeleton mb-skeleton__logo" />
          <div className="skeleton mb-skeleton__line" />
          <div className="skeleton mb-skeleton__line mb-skeleton__line--short" />
        </div>
      </div>
    );
  }

  const mounted = new Set<number>([index]);
  if (previous !== null) mounted.add(previous);
  if (config.preloadCount >= 1 && total > 1) mounted.add((index + 1) % total);

  const dotCount = Math.min(total, config.maxDots);
  const lit = activeDot(index, total, dotCount);

  return (
    <section
      ref={root}
      className={`mediabar mediabar--${config.layout} ${touchLayout ? "mediabar--touch" : ""} ${paused ? "is-paused" : ""} ${videoPlaying ? "has-video" : ""}`}
      style={{ ["--mb-fade" as string]: `${config.fadeTransitionDuration}ms`, ["--mb-interval" as string]: `${config.shuffleInterval}ms` }}
      aria-roledescription="carousel"
      aria-label="Featured"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, input, select")) root.current?.focus({ preventScroll: true });
      }}
      onPointerEnter={(e) => config.pauseOnHover && e.pointerType !== "touch" && setHoverHeld(true)}
      onPointerLeave={(e) => e.pointerType !== "touch" && setHoverHeld(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="mb-slides">
        {[...mounted].sort().map((i) => {
          const item = items[i];
          const active = i === index;
          return (
            <Slide
              key={item.Id}
              ref={active ? trailerHost : undefined}
              item={item}
              config={config}
              active={active}
              position={i}
              total={total}
              listTitle={data.listTitle}
              withVideo={active && videoPlaying}
              hasTrailer={active && Boolean(trailerSource)}
              favorite={isFavorite(item)}
              progressKey={`${i}-${cycle}`}
              progressRunning={running}
              onPlay={() => navigate(`/play/${item.Id}`)}
              onDetails={() => navigate(`/details/${item.Id}`)}
              onFavorite={() => toggleFavorite(item)}
            />
          );
        })}
      </div>

      {!touchLayout && total > 1 && (
        <>
          <button className="mb-arrow mb-arrow--prev" onClick={prev} aria-label="Previous" tabIndex={-1}>
            <Icon name="chevronLeft" size={30} />
          </button>
          <button className="mb-arrow mb-arrow--next" onClick={next} aria-label="Next" tabIndex={-1}>
            <Icon name="chevronRight" size={30} />
          </button>
        </>
      )}

      <div className="mb-controls">
        {dotCount > 1 && (
          <div className="mb-dots" role="tablist" aria-label="Featured titles">
            {Array.from({ length: dotCount }, (_, d) => (
              <button
                key={d}
                className={`mb-dot ${d === lit ? "is-active" : ""}`}
                role="tab"
                aria-selected={d === lit}
                aria-label={`Go to slide group ${d + 1}`}
                tabIndex={-1}
                onClick={() => goTo(total <= dotCount ? d : Math.floor((d / dotCount) * total))}
              />
            ))}
          </div>
        )}
        <div className="mb-buttons">
          {videoPlaying && !touchLayout && (
            <button className="mb-ctrl" onClick={toggleMute} aria-label={muted ? "Unmute trailer" : "Mute trailer"}>
              <Icon name={muted ? "volumeOff" : "volume"} size={18} />
            </button>
          )}
          {total > 1 && (
            <button className="mb-ctrl" onClick={togglePause} aria-label={paused ? "Play slideshow" : "Pause slideshow"}>
              <Icon name={paused ? "play" : "pause"} size={16} />
            </button>
          )}
          <button
            className={`mb-ctrl ${settingsOpen ? "is-active" : ""}`}
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Featured settings"
            aria-expanded={settingsOpen}
          >
            <Icon name="gear" size={17} />
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsPanel mb={mb} onClose={() => setSettingsOpen(false)} />}
    </section>
  );
}
