import type { BaseItem } from "./types";

export const TICKS_PER_SECOND = 10_000_000;
export const TICKS_PER_MINUTE = 600_000_000;

export function formatRuntime(ticks?: number): string {
  if (!ticks || ticks <= 0) return "";
  const totalMinutes = Math.round(ticks / TICKS_PER_MINUTE);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function endsAt(ticks?: number, fromTicks = 0): string {
  if (!ticks) return "";
  const remainingMs = (ticks - fromTicks) / 10_000;
  return new Date(Date.now() + remainingMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function yearOf(item: BaseItem): number | undefined {
  if (item.ProductionYear) return item.ProductionYear;
  if (item.PremiereDate) {
    const y = new Date(item.PremiereDate).getFullYear();
    if (!Number.isNaN(y)) return y;
  }
  return undefined;
}

export function yearRange(item: BaseItem): string {
  const start = yearOf(item);
  if (!start) return "";
  if (item.Type !== "Series") return String(start);
  if (item.Status === "Continuing") return `${start} –`;
  const end = item.EndDate ? new Date(item.EndDate).getFullYear() : undefined;
  return end && end !== start ? `${start} – ${end}` : String(start);
}

export function episodeCode(item: BaseItem): string {
  if (item.Type !== "Episode") return "";
  const s = item.ParentIndexNumber;
  const e = item.IndexNumber;
  if (s === undefined || e === undefined) return "";
  const end = item.IndexNumberEnd ? `–${item.IndexNumberEnd}` : "";
  return `S${s} · E${e}${end}`;
}

export function progressOf(item: BaseItem): number {
  const pct = item.UserData?.PlayedPercentage;
  if (pct && pct > 0) return Math.min(100, pct);
  const pos = item.UserData?.PlaybackPositionTicks;
  if (pos && item.RunTimeTicks) return Math.min(100, (pos / item.RunTimeTicks) * 100);
  return 0;
}

export function cardSubtitle(item: BaseItem): string {
  if (item.Type === "Episode") {
    return [item.SeriesName, episodeCode(item)].filter(Boolean).join(" · ");
  }
  if (item.Type === "Series") return yearRange(item);
  if (item.Type === "BoxSet") return item.ChildCount ? `${item.ChildCount} titles` : "Collection";
  const y = yearOf(item);
  return y ? String(y) : "";
}

export function seasonCountLabel(count?: number): string {
  if (!count) return "";
  return count === 1 ? "1 Season" : `${count} Seasons`;
}

export function joinDots(parts: (string | number | undefined | null | false)[]): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== false && p !== "").join("  ·  ");
}
