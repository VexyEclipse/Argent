import { decode, isBlurhashValid } from "blurhash";

const cache = new Map<string, string>();
const SIZE = 32;

/** Decode a BlurHash to a tiny data URL, used as a placeholder while artwork loads. */
export function blurHashToDataUrl(hash?: string): string | undefined {
  if (!hash) return undefined;
  const hit = cache.get(hash);
  if (hit) return hit;
  try {
    if (!isBlurhashValid(hash).result) return undefined;
    const pixels = decode(hash, SIZE, SIZE);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const image = ctx.createImageData(SIZE, SIZE);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL();
    if (cache.size > 400) cache.clear();
    cache.set(hash, url);
    return url;
  } catch {
    return undefined;
  }
}
