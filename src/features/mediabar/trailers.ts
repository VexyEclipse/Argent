// Trailer players for MediaBar slides: a local trailer file from the server (preferred)
// or a YouTube embed. Both expose the same small interface the slideshow drives.

import { client, getLocalTrailers } from "@/api/jellyfin";

export interface TrailerPlayer {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setMuted(muted: boolean, volume: number): void;
  destroy(): void;
}

export interface TrailerCallbacks {
  onPlaying(): void;
  onEnded(): void;
  onPaused(): void;
  onError(): void;
}

// ---- local trailers ---------------------------------------------------------------

export async function localTrailerUrl(itemId: string): Promise<string | null> {
  try {
    const trailers = await getLocalTrailers(itemId);
    const trailer = trailers?.[0];
    if (!trailer?.Id) return null;
    const mediaSourceId = trailer.MediaSources?.[0]?.Id || trailer.Id;
    const c = client();
    return c.url(`/Videos/${trailer.Id}/stream`, { static: true, mediaSourceId, ApiKey: c.accessToken ?? "" });
  } catch {
    return null;
  }
}

export function createLocalPlayer(video: HTMLVideoElement, cb: TrailerCallbacks): TrailerPlayer {
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const onPlaying = () => cb.onPlaying();
  const onEnded = () => cb.onEnded();
  const onError = () => cb.onError();
  video.addEventListener("playing", onPlaying);
  video.addEventListener("ended", onEnded);
  video.addEventListener("error", onError);
  return {
    play() {
      video.play()?.catch(() => cb.onError());
    },
    pause() {
      video.pause();
    },
    seekTo(s) {
      try {
        video.currentTime = s;
      } catch {
        /* not seekable yet */
      }
    },
    setMuted(muted, volume) {
      video.muted = muted;
      video.volume = Math.max(0, Math.min(1, volume / 100));
    },
    destroy() {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}

// ---- YouTube ----------------------------------------------------------------------

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  destroy(): void;
  unloadModule?(name: string): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number; ENDED: number; PAUSED: number; CUED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytLoading: Promise<YTNamespace | null> | null = null;

export function loadYouTubeApi(timeoutMs: number): Promise<YTNamespace | null> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytLoading) return ytLoading;
  ytLoading = new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      console.warn("MediaBar: YouTube API did not load in time; continuing without YouTube trailers.");
      ytLoading = null;
      resolve(null);
    }, timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timer);
      resolve(window.YT ?? null);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      ytLoading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return ytLoading;
}

/** Opt-in SponsorBlock lookup for a trailer's intro (sends the video id to sponsor.ajay.app). */
export async function sponsorBlockStart(videoId: string): Promise<number> {
  try {
    const r = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=["intro"]`);
    if (r.status !== 200) return 0;
    const segments: { segment: [number, number] }[] = await r.json();
    const intro = segments.find((s) => s.segment[0] < 5);
    return intro ? Math.ceil(intro.segment[1]) : 0;
  } catch {
    return 0;
  }
}

export async function createYouTubePlayer(
  host: HTMLElement,
  videoId: string,
  opts: { captions: boolean; start: number; apiTimeoutMs: number },
  cb: TrailerCallbacks,
): Promise<TrailerPlayer | null> {
  const YT = await loadYouTubeApi(opts.apiTimeoutMs);
  if (!YT || !host.isConnected) return null;
  const mount = document.createElement("div");
  host.appendChild(mount);
  let player: YTPlayer | null = null;
  await new Promise<void>((resolve) => {
    player = new YT.Player(mount, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        mute: 1,
        cc_load_policy: opts.captions ? 1 : 0,
        start: opts.start || undefined,
        origin: location.origin,
      },
      events: {
        onReady: (e: { target: YTPlayer }) => {
          e.target.mute();
          resolve();
        },
        onStateChange: (e: { data: number; target: YTPlayer }) => {
          if (e.data === YT.PlayerState.PLAYING) {
            if (!opts.captions) e.target.unloadModule?.("captions");
            cb.onPlaying();
          } else if (e.data === YT.PlayerState.ENDED) cb.onEnded();
          else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.CUED) cb.onPaused();
        },
        onError: () => {
          cb.onError();
          resolve();
        },
      },
    });
  });
  const p = player as YTPlayer | null;
  if (!p) return null;
  return {
    play: () => p.playVideo(),
    pause: () => p.pauseVideo(),
    seekTo: (s) => p.seekTo(s, true),
    setMuted(muted, volume) {
      if (muted) p.mute();
      else {
        p.unMute();
        p.setVolume(volume);
      }
    },
    destroy: () => {
      try {
        p.destroy();
      } catch {
        /* already gone */
      }
      mount.remove();
    },
  };
}
