import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { backdropImage, landscapeImage, logoImage } from "@/api/images";
import { getItems } from "@/api/jellyfin";
import { formatRuntime, yearOf } from "@/api/format";
import type { BaseItem } from "@/api/types";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { selectTrailerVideoId, MEDIABAR_ALT_TERMS } from "@/features/details/trailerPick";
import { createLocalPlayer, createYouTubePlayer, localTrailerUrl, type TrailerPlayer } from "@/features/mediabar/trailers";
import { setPreviewPlaying, trailersAllowed } from "./store";

const PREVIEW_FIELDS = ["Overview", "Genres", "RemoteTrailers", "LocalTrailerCount", "Taglines", "ChildCount", "PrimaryImageAspectRatio"];

/** What a preview shows that a card doesn't carry: trailers, logo, backdrop. */
export function usePreviewDetails(item: BaseItem | null | undefined) {
  const id = item?.Id;
  const details = useQuery({
    queryKey: ["preview", id],
    queryFn: () =>
      getItems({ ids: [id!], fields: PREVIEW_FIELDS, enableImageTypes: ["Primary", "Backdrop", "Logo", "Thumb", "Banner"] }).then((r) => r.Items[0] ?? null),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });
  // The card's own copy until the details arrive, so nothing waits on the network.
  return details.data && details.data.Id === id ? details.data : (item ?? null);
}

type Source = { kind: "local"; itemId: string; key: string } | { kind: "youtube"; id: string; key: string };

function trailerOf(item: BaseItem): Source | null {
  if (item.Type === "Episode" || item.Type === "Season") return null;
  if ((item.LocalTrailerCount ?? 0) > 0) return { kind: "local", itemId: item.Id, key: `local:${item.Id}` };
  const id = selectTrailerVideoId(item.RemoteTrailers, MEDIABAR_ALT_TERMS);
  return id ? { kind: "youtube", id, key: `yt:${id}` } : null;
}

/** The picture of a preview: the backdrop, then (after a pause) a muted trailer over it. */
export function PreviewMedia({
  item,
  delay,
  active = true,
  muted,
  showLogo,
  className = "",
}: {
  item: BaseItem;
  delay: number;
  active?: boolean;
  muted: boolean;
  showLogo?: boolean;
  className?: string;
}) {
  const image = backdropImage(item, 1280) ?? landscapeImage(item, 1280);
  const logo = showLogo ? logoImage(item, 600) : null;
  const trailer = active && trailersAllowed() ? trailerOf(item) : null;
  const key = trailer?.key ?? "";
  const [playing, setPlaying] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<TrailerPlayer | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!trailer) return;
    let cancelled = false;
    let p: TrailerPlayer | null = null;
    let reveal = 0;
    const callbacks = {
      // YouTube shows its title bar for the first moments of playback: fade in after it.
      onPlaying: () => {
        window.clearTimeout(reveal);
        reveal = window.setTimeout(() => !cancelled && setPlaying(true), trailer.kind === "youtube" ? 2200 : 0);
      },
      onEnded: () => {
        window.clearTimeout(reveal);
        setPlaying(false);
      },
      onPaused: () => {},
      onError: () => {
        window.clearTimeout(reveal);
        setPlaying(false);
      },
    };
    const timer = window.setTimeout(async () => {
      if (trailer.kind === "local") {
        const url = await localTrailerUrl(trailer.itemId);
        if (cancelled || !url || !video.current) return;
        video.current.src = url;
        p = createLocalPlayer(video.current, callbacks);
      } else {
        if (!host.current) return;
        p = await createYouTubePlayer(host.current, trailer.id, { captions: false, start: 4, apiTimeoutMs: 6000 }, callbacks);
        if (cancelled) {
          p?.destroy();
          return;
        }
      }
      if (!p) return;
      player.current = p;
      p.setMuted(mutedRef.current, 70);
      p.play();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(reveal);
      p?.destroy();
      player.current = null;
      setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);

  useEffect(() => {
    player.current?.setMuted(muted, 70);
  }, [muted]);

  useEffect(() => {
    setPreviewPlaying(playing);
  }, [playing]);
  useEffect(() => () => setPreviewPlaying(false), []);

  return (
    <div className={`pmedia ${playing ? "is-playing" : ""} ${className}`}>
      <Artwork image={image} alt="" eager fallbackLabel={item.SeriesName ?? item.Name} />
      {trailer?.kind === "local" && <video ref={video} className="pmedia__video" muted playsInline />}
      {trailer?.kind === "youtube" && <div ref={host} className="pmedia__yt" aria-hidden="true" />}
      <div className="pmedia__shade" />
      {logo && <img className="pmedia__logo" src={logo.url} alt={item.SeriesName ?? item.Name} />}
    </div>
  );
}

/** Whether there's a trailer the preview would play (for the sound button). */
export const hasPreviewTrailer = (item: BaseItem) => trailersAllowed() && trailerOf(item) !== null;

/** Year · runtime or seasons · certificate · rating, for a preview. */
export function PreviewMeta({ item }: { item: BaseItem }) {
  const parts: string[] = [];
  if (item.Type === "Episode") {
    if (item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined) parts.push(`S${item.ParentIndexNumber}:E${item.IndexNumber}`);
  } else {
    const year = yearOf(item);
    if (year) parts.push(String(year));
  }
  if (item.Type === "Series" && item.ChildCount) parts.push(`${item.ChildCount} ${item.ChildCount === 1 ? "season" : "seasons"}`);
  else if (item.RunTimeTicks) parts.push(formatRuntime(item.RunTimeTicks));
  return (
    <p className="pmeta">
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
      {item.OfficialRating && <span className="cert">{item.OfficialRating}</span>}
      {item.CommunityRating ? (
        <span className="pmeta__score">
          <Icon name="star" size={12} /> {item.CommunityRating.toFixed(1)}
        </span>
      ) : null}
    </p>
  );
}
