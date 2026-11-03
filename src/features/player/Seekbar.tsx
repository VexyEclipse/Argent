import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { client } from "@/api/jellyfin";
import { formatClock } from "@/api/format";
import type { BaseItem, TrickplayInfo } from "@/api/types";

interface Props {
  item: BaseItem;
  mediaSourceId?: string;
  current: number;
  duration: number;
  buffered: number;
  onSeek: (seconds: number) => void;
  onScrub?: (active: boolean) => void;
}

function trickplayFor(item: BaseItem, mediaSourceId?: string): { width: number; info: TrickplayInfo } | null {
  const bySource = item.Trickplay?.[mediaSourceId ?? ""] ?? Object.values(item.Trickplay ?? {})[0];
  if (!bySource) return null;
  // Prefer the ~320px set: big enough to read, small enough to load quickly.
  const widths = Object.keys(bySource)
    .map(Number)
    .sort((a, b) => Math.abs(a - 320) - Math.abs(b - 320));
  return widths.length ? { width: widths[0], info: bySource[String(widths[0])] } : null;
}

export function Seekbar({ item, mediaSourceId, current, duration, buffered, onSeek, onScrub }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const trick = trickplayFor(item, mediaSourceId);
  const chapters = (item.Chapters ?? []).map((c) => c.StartPositionTicks / 10_000_000).filter((t) => t > 1 && t < duration - 1);

  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    bar.current!.setPointerCapture(e.pointerId);
    setDragging(at(e.clientX));
    onScrub?.(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const t = at(e.clientX);
    setHover(t);
    if (dragging !== null) setDragging(t);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    onSeek(at(e.clientX));
    setDragging(null);
    onScrub?.(false);
  };

  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") onSeek(Math.max(0, current - 10));
    else if (e.key === "ArrowRight") onSeek(Math.min(duration, current + 10));
    else if (e.key === "Home") onSeek(0);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const shown = dragging ?? current;
  const preview = dragging ?? hover;
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : "0%");

  let thumb: React.CSSProperties | null = null;
  if (trick && preview !== null) {
    const { info, width } = trick;
    const index = Math.min(info.ThumbnailCount - 1, Math.floor((preview * 1000) / info.Interval));
    const perTile = info.TileWidth * info.TileHeight;
    const tile = Math.floor(index / perTile);
    const within = index % perTile;
    const c = client();
    const scale = 240 / info.Width;
    thumb = {
      width: info.Width * scale,
      height: info.Height * scale,
      backgroundImage: `url("${c.url(`/Videos/${item.Id}/Trickplay/${width}/${tile}.jpg`, { mediaSourceId, ApiKey: c.accessToken ?? "" })}")`,
      backgroundSize: `${info.Width * info.TileWidth * scale}px ${info.Height * info.TileHeight * scale}px`,
      backgroundPosition: `-${(within % info.TileWidth) * info.Width * scale}px -${Math.floor(within / info.TileWidth) * info.Height * scale}px`,
    };
  }

  return (
    <div
      className={`seek ${dragging !== null ? "is-dragging" : ""}`}
      ref={bar}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => setHover(null)}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
      onKeyDown={key}
    >
      <div className="seek__track">
        <div className="seek__buffered" style={{ width: pct(buffered) }} />
        <div className="seek__played" style={{ width: pct(shown) }} />
        {chapters.map((t) => (
          <span key={t} className="seek__chapter" style={{ left: pct(t) }} />
        ))}
      </div>
      <div className="seek__knob" style={{ left: pct(shown) }} />
      {preview !== null && (
        <div className="seek__preview" style={{ left: pct(preview) }}>
          {thumb && <div className="seek__thumb" style={thumb} />}
          <span>{formatClock(preview)}</span>
        </div>
      )}
    </div>
  );
}
