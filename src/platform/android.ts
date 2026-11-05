// The Argent Android app's bridge (android/…/MainActivity.java). Absent in a browser, so
// every caller checks `androidApp` first. Older app versions lack the newer methods, so
// those are optional.

interface AndroidBridge {
  /** Close the app, as Back does on a TV app's home screen. */
  exit(): void;
  /** The app's version (versionName). */
  version?(): string;
  /** JSON: what the native player can decode, pass through and display (NativeCapabilities). */
  capabilities?(): string;
  /** Opens the native player with a JSON ExternalRequest; answers through "argent-native" events. */
  play?(request: string): void;
  /** JSON PlayerCommand for the open native player. */
  control?(command: string): void;
  /** Downloads an APK and asks Android to install it; progress through "argent-native" events. */
  installUpdate?(url: string, version: string): void;
  /** Posts a system notification (JSON AppNotification); a click comes back as an "open" event. */
  notify?(notification: string): void;
  /** Asks for the notification permission (Android 13+). */
  requestNotifications?(): void;
}

export const androidApp: AndroidBridge | null = (window as unknown as { argentAndroid?: AndroidBridge }).argentAndroid ?? null;

export interface NativeCapabilities {
  sdk: number;
  model: string;
  tv: boolean;
  video: Record<"h264" | "hevc" | "hevc10" | "av1" | "vp9" | "vp8" | "mpeg2" | "vc1", boolean>;
  hdr: Record<"hdr10" | "hlg" | "dolbyVision" | "hdr10plus", boolean>;
  /** Decodable on the device or passed through to the TV/receiver. */
  audio: Record<"aac" | "mp3" | "opus" | "flac" | "vorbis" | "alac" | "ac3" | "eac3" | "truehd" | "dts" | "dtshd" | "pcm", boolean>;
  /** Sent untouched over HDMI/S/PDIF to a receiver that decodes it. */
  passthrough: Record<"ac3" | "eac3" | "truehd" | "dts" | "dtshd", boolean>;
  maxChannels: number;
  display: { width: number; height: number; refreshRates: number[] };
}

export function nativeCapabilities(): NativeCapabilities | null {
  try {
    const raw = androidApp?.capabilities?.();
    return raw ? (JSON.parse(raw) as NativeCapabilities) : null;
  } catch {
    return null;
  }
}

/** Events the app sends the page: native player state and results, update progress. */
export function onNativeEvent<T = Record<string, unknown>>(fn: (detail: T) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener("argent-native", handler);
  return () => window.removeEventListener("argent-native", handler);
}
