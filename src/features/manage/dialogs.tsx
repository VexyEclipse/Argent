import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItemFull } from "@/api/jellyfin";
import { formatRuntime, joinDots } from "@/api/format";
import { posterImage } from "@/api/images";
import {
  addToCollection,
  addToPlaylist,
  createCollection,
  createPlaylist,
  deleteItem,
  getCollections,
  getPlaylists,
  refreshItem,
  type RefreshMode,
} from "@/api/manage";
import type { BaseItem, MediaStream } from "@/api/types";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { useAuth } from "@/auth/AuthProvider";
import { Dialog, namesOf } from "./Dialog";
import { canFixEpisodes, fixEpisodes } from "./episodeFixes";
import { closeDialog, endSelection } from "./store";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** Runs an action over every item; returns how many failed. */
async function forEach(items: BaseItem[], run: (item: BaseItem) => Promise<unknown>): Promise<number> {
  let failed = 0;
  for (const item of items) {
    try {
      await run(item);
    } catch {
      failed++;
    }
  }
  return failed;
}

// ---- delete ---------------------------------------------------------------------------------

export function DeleteDialog({ items }: { items: BaseItem[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = items.length === 1 ? items[0] : null;
  const onlyCollections = items.every((i) => i.Type === "BoxSet");
  const folders = items.some((i) => i.Type === "Series" || i.Type === "Season");
  // Deleting a whole show or several titles at once asks you to type it out.
  const needsTyping = folders || items.length > 1;
  const ready = !needsTyping || typed.trim().toLowerCase() === "delete";

  const what = onlyCollections
    ? `The ${items.length === 1 ? "collection is" : "collections are"} removed. The movies and shows in ${items.length === 1 ? "it" : "them"} stay in your library.`
    : one?.Type === "Series"
      ? "Every season and episode of this series, and their files, are permanently deleted from your server's disk."
      : one?.Type === "Season"
        ? "Every episode in this season, and their files, are permanently deleted from your server's disk."
        : `The ${items.length === 1 ? "file is" : "files are"} permanently deleted from your server's disk.`;

  const run = async () => {
    setBusy(true);
    setError(null);
    const failed = await forEach(items, (i) => deleteItem(i.Id));
    setBusy(false);
    qc.invalidateQueries();
    if (failed === items.length) {
      setError("The server didn't delete anything. Check that your account is allowed to delete media.");
      return;
    }
    showToast(failed ? `Deleted ${items.length - failed} of ${items.length}` : `Deleted ${namesOf(items)}`);
    endSelection();
    closeDialog();
    // Don't leave the viewer on the page of something that no longer exists.
    const gone = items.find((i) => location.pathname === `/details/${i.Id}`);
    if (gone) navigate(gone.Type === "Episode" && gone.SeriesId ? `/details/${gone.SeriesId}` : "/", { replace: true });
  };

  return (
    <Dialog
      title={onlyCollections ? "Delete collection" : `Delete ${items.length === 1 ? "permanently" : `${items.length} items permanently`}`}
      subtitle={namesOf(items)}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="btn--danger" icon="trash" onClick={run} disabled={!ready || busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="mdialog__warn">
        <Icon name="info" size={18} /> {what} This can't be undone.
      </p>
      {items.length > 1 && (
        <ul className="mdialog__list">
          {items.slice(0, 8).map((i) => (
            <li key={i.Id}>{i.SeriesName ? `${i.SeriesName} · ${i.Name}` : i.Name}</li>
          ))}
          {items.length > 8 && <li className="muted">and {items.length - 8} more</li>}
        </ul>
      )}
      {needsTyping && (
        <label className="field">
          <span className="field__label">Type “delete” to confirm</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
        </label>
      )}
      {error && <p className="mdialog__error">{error}</p>}
    </Dialog>
  );
}

// ---- refresh ----------------------------------------------------------------------------------

const REFRESH_MODES: { value: RefreshMode; label: string; hint: string }[] = [
  { value: "scan", label: "Scan for new and updated files", hint: "Quick. Picks up files that were added, changed or removed." },
  { value: "missing", label: "Search for missing metadata", hint: "Fills in gaps from online providers and keeps what's there." },
  { value: "replace", label: "Replace all metadata", hint: "Fetches everything again. Your manual edits are overwritten unless locked." },
];

export function RefreshDialog({ items }: { items: BaseItem[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState<RefreshMode>("missing");
  const [replaceImages, setReplaceImages] = useState(false);
  const [trickplay, setTrickplay] = useState(false);
  const [fixEpisodesToo, setFixEpisodesToo] = useState(false);
  const [busy, setBusy] = useState(false);
  const episodic = canFixEpisodes(items);

  const run = async () => {
    setBusy(true);
    const failed = await forEach(items, (i) => refreshItem(i.Id, mode, { replaceImages, regenerateTrickplay: trickplay }));
    setBusy(false);
    showToast(
      failed
        ? `Couldn't refresh ${failed} of ${items.length}`
        : fixEpisodesToo && episodic
          ? "Refreshing. Episode titles and pictures follow once Jellyfin is done."
          : "Refreshing. Changes appear in a moment.",
    );
    // After Jellyfin's refresh, so it doesn't overwrite them; runs on after the dialog closes.
    if (fixEpisodesToo && episodic && user) fixEpisodes(items, { userId: user.Id, afterScanOnly: mode === "scan", queryClient: qc });
    // The server works in the background; pick up its results shortly.
    window.setTimeout(() => qc.invalidateQueries(), 5000);
    endSelection();
    closeDialog();
  };

  return (
    <Dialog
      title="Refresh metadata"
      subtitle={namesOf(items)}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="refresh" onClick={run} disabled={busy}>
            {busy ? "Starting…" : "Refresh"}
          </Button>
        </>
      }
    >
      <div className="mdialog__options" role="radiogroup" aria-label="Refresh mode">
        {REFRESH_MODES.map((m) => (
          <button key={m.value} role="radio" aria-checked={mode === m.value} className={`mdialog__option ${mode === m.value ? "is-on" : ""}`} onClick={() => setMode(m.value)}>
            <span className="mdialog__radio" />
            <span>
              <span className="mdialog__option-label">{m.label}</span>
              <span className="mdialog__option-hint">{m.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {episodic && (
        <div className="mdialog__checks">
          <label className="check">
            <input type="checkbox" checked={fixEpisodesToo} onChange={(e) => setFixEpisodesToo(e.target.checked)} />
            <span>
              Fix episode titles and pictures
              <span className="check__hint">
                Titles that are only a file name get their proper title; every episode gets its still from TheMovieDb (replacing the -thumb.jpg beside each video when artwork is kept in media folders).
              </span>
            </span>
          </label>
        </div>
      )}
      {mode !== "scan" && (
        <div className="mdialog__checks">
          <label className="check">
            <input type="checkbox" checked={replaceImages} onChange={(e) => setReplaceImages(e.target.checked)} />
            Replace existing images
          </label>
          <label className="check">
            <input type="checkbox" checked={trickplay} onChange={(e) => setTrickplay(e.target.checked)} />
            Regenerate trickplay previews
          </label>
        </div>
      )}
    </Dialog>
  );
}

// ---- add to collection / playlist -----------------------------------------------------------------

export function AddToListDialog({ items, kind }: { items: BaseItem[]; kind: "collection" | "playlist" }) {
  const qc = useQueryClient();
  const isCollection = kind === "collection";
  const lists = useQuery({
    queryKey: ["manage", kind],
    queryFn: () => (isCollection ? getCollections() : getPlaylists()).then((r) => r.Items),
    staleTime: 30_000,
  });
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = items.map((i) => i.Id);
  const shown = useMemo(() => (lists.data ?? []).filter((l) => l.Name.toLowerCase().includes(filter.trim().toLowerCase())), [lists.data, filter]);
  const noun = isCollection ? "collection" : "playlist";

  const done = (listName: string) => {
    qc.invalidateQueries();
    showToast(`Added ${items.length === 1 ? items[0].Name : `${items.length} items`} to ${listName}`);
    endSelection();
    closeDialog();
  };

  const add = async (list: BaseItem) => {
    setBusy(true);
    setError(null);
    try {
      await (isCollection ? addToCollection(list.Id, ids) : addToPlaylist(list.Id, ids));
      done(list.Name);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await (isCollection ? createCollection(trimmed, ids) : createPlaylist(trimmed, ids));
      done(trimmed);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Add to ${noun}`} subtitle={namesOf(items)} busy={busy}>
      <form
        className="mdialog__create"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input className="input" placeholder={`New ${noun} name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label={`New ${noun} name`} />
        <Button type="submit" variant="secondary" icon="plus" disabled={!name.trim() || busy}>
          Create
        </Button>
      </form>
      {(lists.data?.length ?? 0) > 6 && (
        <input className="input mdialog__filter" placeholder={`Find a ${noun}`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`Find a ${noun}`} />
      )}
      {lists.isPending ? (
        <Spinner />
      ) : lists.isError ? (
        <p className="mdialog__error">{errorText(lists.error)}</p>
      ) : shown.length ? (
        <ul className="mdialog__picks">
          {shown.map((l) => {
            const img = posterImage(l, 80);
            return (
              <li key={l.Id}>
                <button className="mdialog__pick" onClick={() => add(l)} disabled={busy}>
                  <span className="mdialog__pick-thumb">{img ? <img src={img.url} alt="" /> : <Icon name={isCollection ? "stack" : "list"} size={18} />}</span>
                  <span className="mdialog__pick-name">{l.Name}</span>
                  {l.ChildCount ? <span className="mdialog__pick-count">{l.ChildCount}</span> : null}
                  <Icon name="plus" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted mdialog__empty">{lists.data?.length ? `No ${noun}s match.` : `No ${noun}s yet. Create one above.`}</p>
      )}
      {!isCollection && <p className="mdialog__note">Playlists open in other Jellyfin apps. Argent doesn't browse them yet.</p>}
      {error && <p className="mdialog__error">{error}</p>}
    </Dialog>
  );
}

// ---- media info -------------------------------------------------------------------------------------

const formatBytes = (n?: number) => {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
};

const formatBitrate = (n?: number) => (n ? (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} Mbps` : `${Math.round(n / 1000)} kbps`) : "");

function streamRows(s: MediaStream & Record<string, unknown>): [string, string][] {
  const rows: [string, string | number | undefined][] = [
    ["Title", s.DisplayTitle],
    ["Codec", s.Codec?.toUpperCase()],
    ["Profile", s.Profile as string | undefined],
    ["Language", s.Language],
    ["Resolution", s.Width && s.Height ? `${s.Width}×${s.Height}` : undefined],
    ["Range", s.VideoRangeType ?? s.VideoRange],
    ["Frame rate", typeof s.RealFrameRate === "number" ? `${(s.RealFrameRate as number).toFixed(3).replace(/\.?0+$/, "")} fps` : undefined],
    ["Channels", s.ChannelLayout ?? (s.Channels ? String(s.Channels) : undefined)],
    ["Sample rate", typeof s.SampleRate === "number" ? `${s.SampleRate} Hz` : undefined],
    ["Bitrate", formatBitrate(s.BitRate)],
    ["Flags", [s.IsDefault && "Default", s.IsForced && "Forced", s.IsExternal && "External", s.IsHearingImpaired && "SDH"].filter(Boolean).join(", ")],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined && r[1] !== "" && r[1] !== null).map(([k, v]) => [k, String(v)]);
}

export function MediaInfoDialog({ item }: { item: BaseItem }) {
  const full = useQuery({ queryKey: ["item", item.Id], queryFn: () => getItemFull(item.Id), staleTime: 30_000 });
  const sources = full.data?.MediaSources ?? [];

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      showToast("Path copied");
    } catch {
      showToast("Couldn't copy the path");
    }
  };

  return (
    <Dialog title="Media info" subtitle={item.SeriesName ? `${item.SeriesName} · ${item.Name}` : item.Name} wide>
      {full.isPending ? (
        <Spinner />
      ) : !sources.length ? (
        <p className="muted">No media information for this item.</p>
      ) : (
        sources.map((src) => (
          <section className="minfo" key={src.Id}>
            {sources.length > 1 && <h3 className="minfo__source">{src.Name}</h3>}
            <dl className="minfo__summary">
              {src.Path && (
                <div className="minfo__path">
                  <dt>File</dt>
                  <dd>
                    <code>{src.Path}</code>
                    <Button variant="icon" size="sm" icon="copy" onClick={() => copyPath(src.Path!)} aria-label="Copy path" title="Copy path" />
                  </dd>
                </div>
              )}
              {[
                ["Container", src.Container?.toUpperCase()],
                ["Size", formatBytes(src.Size)],
                ["Bitrate", formatBitrate(src.Bitrate)],
                ["Duration", formatRuntime(src.RunTimeTicks ?? full.data?.RunTimeTicks)],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            <div className="minfo__streams">
              {src.MediaStreams.filter((s) => s.Type !== "EmbeddedImage").map((s) => (
                <div className="minfo__stream" key={s.Index}>
                  <h4 className="minfo__stream-title">
                    {s.Type} <span className="muted">#{s.Index}</span>
                  </h4>
                  <dl>
                    {streamRows(s as MediaStream & Record<string, unknown>).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
      {full.data && <p className="mdialog__note">{joinDots([full.data.Type, full.data.Id])}</p>}
    </Dialog>
  );
}
