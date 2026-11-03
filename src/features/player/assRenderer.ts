// Client-side ASS/SSA rendering with JASSUB (libass compiled to WebAssembly), the same
// approach jellyfin-web takes. Styled anime subtitles then keep Direct Play instead of
// forcing the server to burn them into a full video transcode.
//
// Everything here loads on demand: nothing is fetched until an ASS track is shown.

/** Whether this browser can run the renderer (worker + OffscreenCanvas + WASM). */
export function canRenderAss(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof WebAssembly === "object" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype
  );
}

export function isAssCodec(codec?: string): boolean {
  const c = (codec ?? "").toLowerCase();
  return c === "ass" || c === "ssa";
}

export interface AssRenderer {
  /** Seconds to shift subtitles; positive shows them later. */
  setDelay(seconds: number): void;
  destroy(): void;
}

export async function createAssRenderer(opts: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  subUrl: string;
  fonts: string[];
  delay: number;
}): Promise<AssRenderer> {
  // Asset URLs are passed explicitly so they survive bundling and dependency pre-bundling.
  const [{ default: JASSUB }, workerUrl, wasmUrl, modernWasmUrl, defaultFontUrl] = await Promise.all([
    import("jassub"),
    import("jassub/dist/worker/worker.js?worker&url").then((m) => m.default),
    import("jassub/dist/wasm/jassub-worker.wasm?url").then((m) => m.default),
    import("jassub/dist/wasm/jassub-worker-modern.wasm?url").then((m) => m.default),
    import("jassub/dist/default.woff2?url").then((m) => m.default),
  ]);

  const instance = new JASSUB({
    video: opts.video,
    canvas: opts.canvas,
    subUrl: opts.subUrl,
    // Fonts embedded in the file (MKV attachments) give typesetting its intended look.
    fonts: opts.fonts,
    availableFonts: { "liberation sans": defaultFontUrl },
    workerUrl,
    wasmUrl,
    modernWasmUrl,
    // libass reads subtitle time as media time + offset.
    timeOffset: -opts.delay,
    queryFonts: "local",
    // Same limits jellyfin-web uses, which keep heavy karaoke tracks responsive.
    prescaleFactor: 0.8,
    prescaleHeightLimit: 1080,
    maxRenderHeight: 2160,
    libassMemoryLimit: 40,
    libassGlyphLimit: 40,
  });
  await instance.ready;

  return {
    setDelay(seconds) {
      instance.timeOffset = -seconds;
      // Repaint now so the change shows even while paused.
      instance.resize(true).catch(() => {});
    },
    destroy() {
      instance.destroy().catch(() => {});
    },
  };
}
