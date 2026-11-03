import { useEffect, useState } from "react";
import { posterImage } from "@/api/images";
import type { BaseItem } from "@/api/types";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/States";
import type { RatingEntry } from "@/features/ratings/logic";
import { copyImage, renderTopRated, saveImage } from "./exportImage";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const EXPORT_COUNTS = [5, 10, 20] as const;

export function ExportDialog({
  entries,
  items,
  userName,
  onClose,
}: {
  entries: [string, RatingEntry][];
  items: Map<string, BaseItem>;
  userName: string;
  onClose: () => void;
}) {
  // Only offer sizes you have enough ratings for; 10 by default.
  const options = EXPORT_COUNTS.filter((_, i) => i === 0 || entries.length > EXPORT_COUNTS[i - 1]);
  const [count, setCount] = useState<number>(() => Math.min(10, options[options.length - 1]));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    const top = entries.slice(0, count).map(([id, e]) => {
      const item = items.get(id);
      return { name: e.name, stars: e.stars, year: item?.ProductionYear, poster: item ? posterImage(item, 480)?.url : undefined };
    });
    renderTopRated({
      title: `${userName}'s highest rated`,
      subtitle: `Top ${top.length} · ${fmtDate(Date.now())}`,
      entries: top,
    })
      .then((b) => !cancelled && setBlob(b))
      .catch(() => !cancelled && setStatus("Couldn't render the image"));
    return () => {
      cancelled = true;
    };
  }, [count, entries, items, userName]);

  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!blob) return;
    try {
      await copyImage(blob);
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Your browser blocked clipboard access. Use Save instead.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-label="Export highest rated" data-nav-trap>
      <div className="modal mp-export" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 className="modal__title">Export highest rated</h2>
          <Button variant="icon" icon="close" aria-label="Close" onClick={onClose} />
        </header>
        <div className="tabs mp-export__count" role="radiogroup" aria-label="How many">
          {options.map((n) => (
            <button key={n} role="radio" aria-checked={count === n} className={count === n ? "is-active" : ""} onClick={() => setCount(n)}>
              Top {n}
            </button>
          ))}
        </div>
        <div className="mp-export__preview">{url ? <img src={url} alt="Preview of the exported image" /> : <Spinner label="Rendering" />}</div>
        <div className="mp-export__actions">
          <span className="mp-muted" aria-live="polite">
            {status}
          </span>
          <Button variant="secondary" icon="copy" disabled={!blob} onClick={copy}>
            Copy image
          </Button>
          <Button variant="primary" icon="download" disabled={!blob} onClick={() => blob && saveImage(blob, `argent-top-${count}.png`)}>
            Save PNG
          </Button>
        </div>
      </div>
    </div>
  );
}
