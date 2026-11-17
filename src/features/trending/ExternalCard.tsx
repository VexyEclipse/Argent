import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { Artwork } from "@/components/Artwork";
import { Icon } from "@/components/Icon";
import { TrailerModal } from "@/features/details/Trailer";
import type { TrendEntry } from "./logic";
import { trailerFor, useTmdbKey } from "./store";

const sourceName = (entry: TrendEntry) => (entry.key.startsWith("anilist") ? "AniList" : "TMDB");

function metaLine(entry: TrendEntry): string[] {
  const out: string[] = [];
  if (entry.year) out.push(String(entry.year));
  out.push(entry.kind === "anime" ? (entry.format === "movie" ? "Anime film" : "Anime") : entry.kind === "movies" ? "Film" : "Series");
  if (entry.episodes && entry.format === "series") out.push(`${entry.episodes} episodes`);
  if (entry.studio) out.push(entry.studio);
  return out;
}

/** A trending title that isn't in your library: its poster, tagged, opening an info sheet. */
export function ExternalCard({ entry }: { entry: TrendEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card card--poster card--external">
      <button className="card__link" onClick={() => setOpen(true)} title={`${entry.title} (not in your library)`}>
        <div className="card__media">
          <Artwork image={entry.poster ? { url: entry.poster } : null} alt="" fallbackLabel={entry.title} />
          <div className="card__veil" />
          <span className="card__tag">Not in library</span>
        </div>
        <div className="card__text">
          <span className="card__title">{entry.title}</span>
          <span className="card__sub">{metaLine(entry).slice(0, 2).join(" · ")}</span>
        </div>
      </button>
      {open && <ExternalSheet entry={entry} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ExternalSheet({ entry, onClose }: { entry: TrendEntry; onClose: () => void }) {
  const { key } = useTmdbKey();
  const [playing, setPlaying] = useState(false);
  const trailer = useQuery({
    queryKey: ["trending-trailer", entry.key],
    queryFn: () => trailerFor(entry, key),
    staleTime: 24 * 3_600_000,
  });

  useEffect(() => {
    if (playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, playing]);

  return createPortal(
    <div className="modal-backdrop xsheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-nav-trap>
      <div className="modal xsheet" role="dialog" aria-modal="true" aria-label={entry.title}>
        <div
          className={`xsheet__hero ${entry.backdrop ? "" : "xsheet__hero--blur"}`}
          style={entry.backdrop || entry.poster ? { backgroundImage: `url("${entry.backdrop ?? entry.poster}")` } : undefined}
        />
        <div className="xsheet__body">
          {entry.poster && <img className="xsheet__poster" src={entry.poster} alt="" referrerPolicy="no-referrer" />}
          <div className="xsheet__text">
            <span className="xsheet__tag">
              <Icon name="info" size={14} /> Not in your library
            </span>
            <h2 className="xsheet__title">{entry.title}</h2>
            <p className="xsheet__meta">
              {metaLine(entry).join(" · ")}
              {entry.score ? (
                <span className="xsheet__score">
                  <Icon name="star" size={13} /> {entry.score.toFixed(1)}
                </span>
              ) : null}
            </p>
            {entry.genres.length > 0 && <p className="xsheet__genres">{entry.genres.slice(0, 5).join(" · ")}</p>}
            {entry.overview && <p className="xsheet__overview">{entry.overview}</p>}
            <div className="xsheet__actions">
              {trailer.data && (
                <Button variant="primary" icon="play" onClick={() => setPlaying(true)} data-autofocus>
                  Watch trailer
                </Button>
              )}
              <a className="btn btn--secondary btn--md" href={entry.url} target="_blank" rel="noreferrer" data-autofocus={trailer.data ? undefined : true}>
                <Icon name="external" size={18} /> <span className="btn__label">View on {sourceName(entry)}</span>
              </a>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
      {playing && trailer.data && <TrailerModal trailer={{ kind: "youtube", id: trailer.data }} title={entry.title} onClose={() => setPlaying(false)} />}
    </div>,
    document.body,
  );
}
