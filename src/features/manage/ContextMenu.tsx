import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { getItemFull, setFavorite, setPlayed } from "@/api/jellyfin";
import { landscapeImage, posterImage } from "@/api/images";
import { cardSubtitle, progressOf } from "@/api/format";
import { canIdentify, downloadUrl, streamUrl } from "@/api/manage";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Icon, type IconName } from "@/components/Icon";
import { showToast } from "@/components/Toast";
import { addToWatchlist, canWatchlist, removeFromWatchlist, useWatchlist } from "@/features/watchlist/store";
import { desktop } from "@/platform/desktop";
import { closeMenu, openDialog, startSelection, type MenuState } from "./store";

interface Action {
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
  danger?: boolean;
}

const FILE_TYPES = new Set(["Movie", "Episode", "Video", "MusicVideo", "Trailer"]);
const PLAYLIST_TYPES = new Set(["Movie", "Episode", "Series", "Season", "Video", "MusicVideo", "BoxSet"]);
const TYPE_LABEL: Record<string, string> = { Movie: "movie", Episode: "episode", Series: "series", Season: "season", BoxSet: "collection", Video: "video" };

/** Everything an administrator can do with one title, grouped as the menu shows it. */
function useActions(item: BaseItem): Action[][] {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const watchlist = useWatchlist();
  const refreshAll = () => qc.invalidateQueries();
  const isFile = FILE_TYPES.has(item.Type);
  const playable = item.LocationType !== "Virtual" && item.Type !== "Person" && item.Type !== "Genre";
  const progress = progressOf(item);
  const played = Boolean(item.UserData?.Played);
  const favourite = Boolean(item.UserData?.IsFavorite);
  const onList = Boolean(watchlist.items[item.Id]);
  const noun = TYPE_LABEL[item.Type] ?? "item";

  const watch: Action[] = [];
  if (playable) {
    watch.push({ id: "play", label: progress > 0 && progress < 98 ? "Resume" : "Play", icon: "play", run: () => navigate(`/play/${item.Id}`) });
    if (progress > 0 && progress < 98) watch.push({ id: "restart", label: "Play from start", icon: "skipPrev", run: () => navigate(`/play/${item.Id}?start=0`) });
  }
  if (item.Type !== "BoxSet" && playable)
    watch.push({
      id: "played",
      label: played ? "Mark unwatched" : "Mark watched",
      icon: played ? "eye" : "check",
      run: () => setPlayed(item.Id, !played).then(refreshAll),
    });
  watch.push({
    id: "favourite",
    label: favourite ? "Remove from favourites" : "Add to favourites",
    icon: favourite ? "heartFilled" : "heart",
    run: () => setFavorite(item.Id, !favourite).then(refreshAll),
  });
  if (canWatchlist(item) && user)
    watch.push({
      id: "watchlist",
      label: onList ? "Remove from watchlist" : "Add to watchlist",
      icon: onList ? "bookmarkFilled" : "bookmark",
      run: () => (onList ? removeFromWatchlist(user.Id, item.Id) : addToWatchlist(user.Id, item)),
    });

  const organise: Action[] = [{ id: "select", label: "Select", icon: "select", run: () => startSelection(item) }];
  if (item.Type !== "BoxSet") organise.push({ id: "collection", label: "Add to collection", icon: "stack", run: () => openDialog("collection", [item]) });
  if (PLAYLIST_TYPES.has(item.Type)) organise.push({ id: "playlist", label: "Add to playlist", icon: "list", run: () => openDialog("playlist", [item]) });

  const files: Action[] = [];
  if (isFile) {
    files.push({
      id: "download",
      label: "Download",
      icon: "download",
      run: () => {
        const url = downloadUrl(item.Id);
        if (desktop) desktop.download(url);
        else {
          // Jellyfin sends it as an attachment, so the page stays put.
          const a = document.createElement("a");
          a.href = url;
          a.rel = "noreferrer";
          a.click();
        }
        showToast("Download started");
      },
    });
    files.push({
      id: "stream",
      label: "Copy stream URL",
      icon: "link",
      run: async () => {
        try {
          const full = item.MediaSources?.length ? item : await getItemFull(item.Id);
          await navigator.clipboard.writeText(streamUrl(full));
          showToast("Stream URL copied. It contains your access key, so don't share it.");
        } catch {
          showToast("Couldn't copy the stream URL");
        }
      },
    });
  }

  const manage: Action[] = [
    { id: "metadata", label: "Edit metadata", icon: "pencil", run: () => openDialog("metadata", [item]) },
  ];
  // Fix a wrong match (e.g. it picked up another show's metadata).
  if (canIdentify(item)) manage.push({ id: "identify", label: "Identify", icon: "search", run: () => openDialog("identify", [item]) });
  manage.push({ id: "images", label: "Edit images", icon: "image", run: () => openDialog("images", [item]) });
  if (isFile) {
    manage.push({ id: "subtitles", label: "Edit subtitles", icon: "subtitles", run: () => openDialog("subtitles", [item]) });
    manage.push({ id: "info", label: "Media info", icon: "info", run: () => openDialog("info", [item]) });
  }
  manage.push({ id: "refresh", label: "Refresh metadata", icon: "refresh", run: () => openDialog("refresh", [item]) });

  const danger: Action[] = [{ id: "delete", label: `Delete ${noun}`, icon: "trash", danger: true, run: () => openDialog("delete", [item]) }];

  return [watch, organise, files, manage, danger].filter((g) => g.length);
}

const MARGIN = 8;

export function ContextMenu({ menu }: { menu: MenuState }) {
  const { item } = menu;
  const groups = useActions(item);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const thumb = item.Type === "Episode" ? landscapeImage(item, 160) : posterImage(item, 96);
  const sub = [item.Type === "BoxSet" ? "Collection" : item.Type === "Series" ? "Series" : item.Type === "Episode" ? item.SeriesName : item.Type, cardSubtitle(item)]
    .filter(Boolean)
    .join(" · ");

  // Keep the whole menu on screen: shift left at the right edge, open upwards near the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(menu.x, window.innerWidth - width - MARGIN));
    const fitsBelow = menu.y + height + MARGIN <= window.innerHeight;
    const above = (menu.fromButton ? menu.y - 52 : menu.y) - height;
    // Below the pointer if it fits, else above it, else as close as the screen allows.
    const top = fitsBelow ? menu.y : above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - height - MARGIN);
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!pos) return;
    // From a button (keyboard, remote): focus the first action. From a right-click: focus
    // the menu itself, so arrows work without an item looking pre-selected.
    if (menu.fromButton) ref.current?.querySelector<HTMLButtonElement>(".cmenu__item")?.focus({ preventScroll: true });
    else ref.current?.focus({ preventScroll: true });
  }, [pos, menu.fromButton]);

  useEffect(() => {
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && closeMenu();
    const close = () => closeMenu();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".cmenu__item") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") focus(i + 1);
    else if (e.key === "ArrowUp") focus(i - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(items.length - 1);
    else if (e.key === "Escape" || e.key === "Tab" || e.key === "Backspace") closeMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className="cmenu"
      tabIndex={-1}
      role="menu"
      aria-label={`Actions for ${item.Name}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      data-nav-trap
      data-own-keys
    >
      <div className="cmenu__head">
        <span className={`cmenu__thumb ${item.Type === "Episode" ? "is-wide" : ""}`}>{thumb && <img src={thumb.url} alt="" />}</span>
        <span className="cmenu__titles">
          <span className="cmenu__title">{item.Name}</span>
          {sub && <span className="cmenu__sub">{sub}</span>}
        </span>
      </div>
      {groups.map((group, g) => (
        <div className="cmenu__group" role="group" key={g}>
          {group.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              className={`cmenu__item ${a.danger ? "is-danger" : ""}`}
              onClick={() => {
                closeMenu();
                a.run();
              }}
            >
              <Icon name={a.icon} size={17} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
