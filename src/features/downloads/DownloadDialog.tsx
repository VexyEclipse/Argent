import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { BaseItem } from "@/api/types";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { showToast } from "@/components/Toast";
import { estimateBytes, formatBytes, QUALITIES, type QualityId } from "./logic";
import { downloadItems, readQualityChoice, saveQualityChoice, storageEstimate } from "./store";
import "./downloads.css";

/** Size of each choice for these titles: exact for Original, estimated for converted copies. */
function sizeFor(items: BaseItem[], quality: QualityId): number {
  const preset = QUALITIES.find((q) => q.id === quality)!;
  return items.reduce((sum, i) => sum + (quality === "original" ? (i.MediaSources?.[0]?.Size ?? estimateBytes(i, 12_000_000)) : estimateBytes(i, preset.bitrate)), 0);
}

/** Choose a quality (and, for one title, an audio track), then queue the download. */
export function DownloadDialog({ items, title, onClose }: { items: BaseItem[]; title: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [quality, setQuality] = useState<QualityId>(readQualityChoice);
  const audioTracks = items.length === 1 ? (items[0].MediaSources?.[0]?.MediaStreams ?? []).filter((s) => s.Type === "Audio") : [];
  const [audio, setAudio] = useState<number | undefined>(items[0]?.MediaSources?.[0]?.DefaultAudioStreamIndex);
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    storageEstimate().then((e) => setFree(e?.free ?? null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const size = sizeFor(items, quality);
  const tooBig = free !== null && size > free;

  const start = () => {
    saveQualityChoice(quality);
    const n = downloadItems(items, { quality, audioIndex: audioTracks.length > 1 ? audio : undefined });
    onClose();
    showToast(n ? `Downloading ${n === 1 ? items.find((i) => i.LocationType !== "Virtual")?.Name ?? title : `${n} episodes`}` : "Already downloaded", {
      label: "View",
      run: () => navigate("/downloads"),
    });
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-nav-trap>
      <div className="modal dl-dialog" role="dialog" aria-modal="true" aria-label={`Download ${title}`}>
        <header className="dl-dialog__head">
          <div>
            <h2 className="modal__title">Download</h2>
            <p className="dl-dialog__sub">{title}</p>
          </div>
          <Button variant="icon" icon="close" onClick={onClose} aria-label="Close" />
        </header>

        <div className="dl-dialog__options" role="radiogroup" aria-label="Quality">
          {QUALITIES.map((q) => (
            <button key={q.id} role="radio" aria-checked={quality === q.id} className={`dl-option ${quality === q.id ? "is-active" : ""}`} onClick={() => setQuality(q.id)}>
              <span className="dl-option__check">{quality === q.id && <Icon name="check" size={16} />}</span>
              <span className="dl-option__text">
                <span className="dl-option__label">{q.label}</span>
                <span className="dl-option__detail">{q.detail}</span>
              </span>
              <span className="dl-option__size">{q.id === "original" ? "" : "~"}{formatBytes(sizeFor(items, q.id))}</span>
            </button>
          ))}
        </div>

        {audioTracks.length > 1 && (
          <label className="field">
            <span className="field__label">Audio</span>
            <select className="select" value={audio ?? ""} onChange={(e) => setAudio(Number(e.target.value))}>
              {audioTracks.map((a) => (
                <option key={a.Index} value={a.Index}>
                  {a.DisplayTitle || a.Language || `Track ${a.Index}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="dl-dialog__note">
          Subtitles in text formats come with it. {quality === "original" ? "If this device can't play the file as it is, a High-quality copy is made instead." : "The server makes the copy as it downloads, so a long film can take a while."}
          {free !== null && ` ${formatBytes(free)} free on this device.`}
        </p>
        {tooBig && <p className="dl-dialog__warn">That's more than the space left on this device.</p>}

        <footer className="dl-dialog__foot">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="download" onClick={start} autoFocus>
            Download{items.length > 1 ? ` ${items.length}` : ""}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/** A Download dialog to open from anywhere: `open(items, title)`, and render `dialog`. */
export function useDownloadDialog() {
  const [state, setState] = useState<{ items: BaseItem[]; title: string } | null>(null);
  return {
    open: (items: BaseItem[], title: string) => setState({ items, title }),
    dialog: state && <DownloadDialog items={state.items} title={state.title} onClose={() => setState(null)} />,
  };
}
