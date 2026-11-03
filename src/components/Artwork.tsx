import { useState, type CSSProperties } from "react";
import { blurHashToDataUrl } from "./blurhash";
import type { ImageRef } from "@/api/images";

interface Props {
  image: ImageRef | null;
  alt?: string;
  className?: string;
  fallbackLabel?: string;
  eager?: boolean;
  style?: CSSProperties;
}

/**
 * Artwork with a BlurHash placeholder that cross-fades to the real image once loaded.
 * Missing artwork shows a typographic placeholder instead of a broken image.
 */
export function Artwork({ image, alt = "", className = "", fallbackLabel, eager, style }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const placeholder = blurHashToDataUrl(image?.blurHash);

  if (!image || failed) {
    return (
      <div className={`artwork artwork--empty ${className}`} style={style} role={alt ? "img" : undefined} aria-label={alt || undefined}>
        {fallbackLabel && <span className="artwork__label">{fallbackLabel}</span>}
      </div>
    );
  }

  return (
    <div
      className={`artwork ${loaded ? "is-loaded" : ""} ${className}`}
      style={{ ...style, backgroundImage: placeholder ? `url("${placeholder}")` : undefined }}
    >
      <img
        src={image.url}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
