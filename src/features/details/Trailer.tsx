import { useEffect, useState } from "react";
import type { BaseItem } from "@/api/types";
import { Icon } from "@/components/Icon";
import { localTrailerUrl } from "@/features/mediabar/trailers";
import { selectTrailerVideoId, MEDIABAR_ALT_TERMS } from "./trailerPick";

export type Trailer = { kind: "local"; itemId: string } | { kind: "youtube"; id: string };

export function useTrailer(item: BaseItem): Trailer | null {
  if ((item.LocalTrailerCount ?? 0) > 0) return { kind: "local", itemId: item.Id };
  const id = selectTrailerVideoId(item.RemoteTrailers, MEDIABAR_ALT_TERMS);
  return id ? { kind: "youtube", id } : null;
}

export function TrailerModal({ trailer, title, onClose }: { trailer: Trailer; title: string; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (trailer.kind === "local") localTrailerUrl(trailer.itemId).then(setSrc);
  }, [trailer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop trailer-modal" onClick={onClose} role="dialog" aria-label={`${title} trailer`} data-nav-trap>
      <div className="trailer-modal__frame" onClick={(e) => e.stopPropagation()}>
        {trailer.kind === "youtube" ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0&modestbranding=1`}
            title={`${title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : src ? (
          <video src={src} controls autoPlay playsInline />
        ) : null}
      </div>
      <button className="btn btn--icon trailer-modal__close" onClick={onClose} aria-label="Close trailer" data-autofocus>
        <Icon name="close" />
      </button>
    </div>
  );
}
