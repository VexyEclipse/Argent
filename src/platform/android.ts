// The Argent Android app's bridge (android/…/MainActivity.java). Absent in a browser, so
// every caller checks `androidApp` first.

interface AndroidBridge {
  /** Close the app, as Back does on a TV app's home screen. */
  exit(): void;
}

export const androidApp: AndroidBridge | null = (window as unknown as { argentAndroid?: AndroidBridge }).argentAndroid ?? null;
