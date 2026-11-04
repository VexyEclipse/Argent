import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { setPlayed } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { showToast } from "@/components/Toast";
import { ContextMenu } from "./ContextMenu";
import { AddToListDialog, DeleteDialog, MediaInfoDialog, RefreshDialog } from "./dialogs";
import { IdentifyDialog } from "./IdentifyDialog";
import { ImageEditor } from "./ImageEditor";
import { MetadataEditor } from "./MetadataEditor";
import { SubtitleEditor } from "./SubtitleEditor";
import { closeMenu, endSelection, openDialog, useManageState } from "./store";
import "./manage.css";

/** Bar shown while selecting several titles, with what can be done to all of them. */
function SelectionBar({ items }: { items: BaseItem[] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      endSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const markAll = async (value: boolean) => {
    setBusy(true);
    let failed = 0;
    for (const i of items) await setPlayed(i.Id, value).catch(() => failed++);
    setBusy(false);
    qc.invalidateQueries();
    showToast(failed ? `Couldn't update ${failed} of ${items.length}` : `Marked ${items.length} ${value ? "watched" : "unwatched"}`);
    endSelection();
  };

  const none = items.length === 0;
  return (
    <div className="selbar" role="toolbar" aria-label="Selection">
      <span className="selbar__count">{none ? "Select titles" : `${items.length} selected`}</span>
      <div className="selbar__actions">
        <Button variant="ghost" size="sm" icon="stack" disabled={none || busy} onClick={() => openDialog("collection", items)}>
          Collection
        </Button>
        <Button variant="ghost" size="sm" icon="list" disabled={none || busy} onClick={() => openDialog("playlist", items)}>
          Playlist
        </Button>
        <Button variant="ghost" size="sm" icon="check" disabled={none || busy} onClick={() => markAll(true)}>
          Watched
        </Button>
        <Button variant="ghost" size="sm" icon="eye" disabled={none || busy} onClick={() => markAll(false)}>
          Unwatched
        </Button>
        <Button variant="ghost" size="sm" icon="refresh" disabled={none || busy} onClick={() => openDialog("refresh", items)}>
          Refresh
        </Button>
        <Button variant="ghost" size="sm" icon="trash" className="selbar__danger" disabled={none || busy} onClick={() => openDialog("delete", items)}>
          Delete
        </Button>
      </div>
      <Button variant="icon" size="sm" icon="close" onClick={endSelection} aria-label="Stop selecting" title="Done (Esc)" />
    </div>
  );
}

/**
 * Library management for administrators: the right-click menu, its dialogs and
 * multi-select. Renders nothing for everyone else.
 */
export function ManageHost() {
  const { isAdmin } = useAuth();
  const { menu, dialog, selection } = useManageState();
  const location = useLocation();

  // A new page closes the menu; selections don't carry across pages.
  useEffect(() => {
    closeMenu();
    endSelection();
  }, [location.pathname]);

  if (!isAdmin) return null;
  const items = dialog?.items ?? [];
  return (
    <>
      {menu && <ContextMenu menu={menu} key={`${menu.item.Id}-${menu.x}-${menu.y}`} />}
      {selection && <SelectionBar items={[...selection.values()]} />}
      {dialog?.kind === "delete" && <DeleteDialog items={items} />}
      {dialog?.kind === "refresh" && <RefreshDialog items={items} />}
      {dialog?.kind === "collection" && <AddToListDialog items={items} kind="collection" />}
      {dialog?.kind === "playlist" && <AddToListDialog items={items} kind="playlist" />}
      {dialog?.kind === "info" && <MediaInfoDialog item={items[0]} />}
      {dialog?.kind === "metadata" && <MetadataEditor item={items[0]} />}
      {dialog?.kind === "identify" && <IdentifyDialog item={items[0]} />}
      {dialog?.kind === "images" && <ImageEditor item={items[0]} />}
      {dialog?.kind === "subtitles" && <SubtitleEditor item={items[0]} />}
    </>
  );
}
