import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { episodeCode, formatRuntime } from "@/api/format";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/States";
import { formatBytes, groupDownloads, percentOf, type DownloadRecord } from "./logic";
import { downloadsSupported, fileUrl, pauseDownload, removeDownload, retryDownload, storageEstimate, useDownloads } from "./store";
import "./downloads.css";

/** Artwork from the device (it was saved with the download), so it shows offline too. */
function LocalImage({ file, className }: { file?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fileUrl(file).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [file]);
  return <div className={`dl-art ${className ?? ""}`}>{url ? <img src={url} alt="" loading="lazy" /> : <Icon name="film" size={22} />}</div>;
}

function status(r: DownloadRecord): string {
  switch (r.state) {
    case "done":
      return formatBytes(r.bytes);
    case "downloading":
      return r.bytes ? `${percentOf(r)}% · ${formatBytes(r.bytes)} of ~${formatBytes(r.total)}` : "Preparing…";
    case "queued":
      return "Waiting";
    case "paused":
      return `Paused${r.bytes ? ` · ${formatBytes(r.bytes)}` : ""}`;
    case "failed":
      return r.error ?? "Download failed";
  }
}

function Row({ r, offline }: { r: DownloadRecord; offline: boolean }) {
  const navigate = useNavigate();
  const episode = r.item.Type === "Episode";
  const progress = r.item.RunTimeTicks ? (r.position / r.item.RunTimeTicks) * 100 : 0;
  const play = () => navigate(`/play/${r.id}?offline=1`);
  return (
    <li className={`dl-row dl-row--${r.state}`}>
      <button className="dl-row__thumb" onClick={play} disabled={r.state !== "done"} aria-label={`Play ${r.item.Name}`}>
        <LocalImage file={episode ? r.files.thumb : r.files.poster} className={episode ? "dl-art--wide" : "dl-art--poster"} />
        {r.state === "done" && (
          <span className="dl-row__play">
            <Icon name="play" size={18} />
          </span>
        )}
        {r.state === "done" && progress > 0 && !r.played && (
          <span className="card__progress">
            <span style={{ width: `${progress}%` }} />
          </span>
        )}
      </button>
      <div className="dl-row__text">
        <span className="dl-row__title">
          {episode && <span className="dl-row__code">{episodeCode(r.item)}</span>}
          {r.item.Name}
          {r.played && <Icon name="check" size={14} className="dl-row__watched" />}
        </span>
        <span className={`dl-row__status ${r.state === "failed" ? "is-error" : ""}`}>
          {[status(r), r.state === "done" && formatRuntime(r.item.RunTimeTicks), r.dirty && !offline && "Syncing progress"].filter(Boolean).join("  ·  ")}
        </span>
        {(r.state === "downloading" || r.state === "paused") && r.bytes > 0 && (
          <span className="dl-row__bar">
            <span style={{ width: `${percentOf(r)}%` }} />
          </span>
        )}
      </div>
      <div className="dl-row__actions">
        {r.state === "downloading" && <Button variant="icon" size="sm" icon="pause" onClick={() => pauseDownload(r.id)} aria-label="Pause" title="Pause" />}
        {(r.state === "failed" || r.state === "paused") && !offline && (
          <Button variant="icon" size="sm" icon="refresh" onClick={() => retryDownload(r.id)} aria-label={r.state === "paused" ? "Resume" : "Try again"} title={r.state === "paused" ? "Resume" : "Try again"} />
        )}
        <Button variant="icon" size="sm" icon={r.state === "done" ? "trash" : "close"} onClick={() => removeDownload(r.id)} aria-label={r.state === "done" ? "Delete download" : "Cancel"} title={r.state === "done" ? "Delete" : "Cancel"} />
      </div>
    </li>
  );
}

export default function DownloadsPage() {
  const { status: auth } = useAuth();
  const offline = auth === "offline";
  const records = useDownloads();
  const [space, setSpace] = useState<{ used: number; free: number } | null>(null);
  const busy = records.some((r) => r.state === "downloading");
  useEffect(() => {
    storageEstimate().then(setSpace);
  }, [records.length, busy]);

  if (!downloadsSupported())
    return (
      <div className="page">
        <h1 className="page-title">Downloads</h1>
        <EmptyState
          title="Downloads aren't available here"
          body="Saving titles for offline needs the Argent app (Windows or Android), or the web version opened over https. On an iPhone, add the https web version to your home screen."
        />
      </div>
    );

  const { movies, shows } = groupDownloads(records);
  const saved = records.filter((r) => r.state === "done").reduce((n, r) => n + r.bytes, 0);

  return (
    <div className="page downloads">
      <header className="page-header downloads__header">
        <div>
          <h1 className="page-title">Downloads</h1>
          <p className="muted">
            {records.length ? `${records.length} ${records.length === 1 ? "title" : "titles"} · ${formatBytes(saved)}` : "Nothing yet"}
            {space ? ` · ${formatBytes(space.free)} free` : ""}
          </p>
        </div>
      </header>

      {!records.length && (
        <EmptyState
          title="Watch without a connection"
          body="Press the download button on a film or episode, or Download season on a show, and it's saved to this device. Your progress syncs when you're back online."
          action={
            !offline && (
              <Link className="btn btn--secondary btn--md" to="/">
                Browse
              </Link>
            )
          }
        />
      )}

      {movies.length > 0 && (
        <section className="downloads__group">
          <h2 className="row__title">Films</h2>
          <ul className="dl-list">
            {movies.map((r) => (
              <Row key={r.id} r={r} offline={offline} />
            ))}
          </ul>
        </section>
      )}

      {shows.map((s) => (
        <section key={s.seriesId} className="downloads__group">
          <h2 className="row__title downloads__show">
            {offline ? s.name : <Link to={`/details/${s.seriesId}`}>{s.name}</Link>}
            <span className="muted">
              {s.episodes.length} {s.episodes.length === 1 ? "episode" : "episodes"}
            </span>
          </h2>
          <ul className="dl-list">
            {s.episodes.map((r) => (
              <Row key={r.id} r={r} offline={offline} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
