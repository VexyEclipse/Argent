// Player preferences kept on this device: volume, quality cap, the autoplay chain, the
// version last chosen for each title, and which player to use.

const VOLUME_KEY = "argent.volume";
const QUALITY_KEY = "argent.maxBitrate";
const CHAIN_KEY = "argent.autoplayChain";
const VERSIONS_KEY = "argent.versions";
const ENGINE_KEY = "argent.playerEngine";
const MAX_REMEMBERED_VERSIONS = 300;

function readNumber(storage: Storage, key: string, fallback: number) {
  try {
    const raw = storage.getItem(key);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeValue(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const readVolume = () => readNumber(localStorage, VOLUME_KEY, 1);
export const saveVolume = (v: number) => writeValue(localStorage, VOLUME_KEY, String(v));
export const readQuality = (fallback: number) => readNumber(localStorage, QUALITY_KEY, fallback);
export const saveQuality = (bitrate: number) => writeValue(localStorage, QUALITY_KEY, String(bitrate));

/** Episodes autoplayed in a row without anyone touching anything (per tab). */
export const readAutoplayChain = () => readNumber(sessionStorage, CHAIN_KEY, 0);
export const writeAutoplayChain = (n: number) => writeValue(sessionStorage, CHAIN_KEY, String(n));

function readVersions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(VERSIONS_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

/** The version (media source) last chosen for a title, so resuming it plays the same file. */
export const rememberedVersion = (itemId: string): string | undefined => readVersions()[itemId];

export function rememberVersion(itemId: string, sourceId: string) {
  const all = readVersions();
  delete all[itemId];
  all[itemId] = sourceId;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_VERSIONS))) delete all[k];
  writeValue(localStorage, VERSIONS_KEY, JSON.stringify(all));
}

/** "native": the Android app's own player or mpv in the desktop app. "web": this page's player. */
export type EngineChoice = "native" | "web";

export function readEngine(): EngineChoice {
  try {
    return localStorage.getItem(ENGINE_KEY) === "web" ? "web" : "native";
  } catch {
    return "native";
  }
}

export const saveEngine = (e: EngineChoice) => writeValue(localStorage, ENGINE_KEY, e);

const MATCH_FRAME_RATE_KEY = "argent.matchFrameRate";

/** The Android player switches the TV to the video's frame rate (24p, 25p…). */
export function readMatchFrameRate(): boolean {
  try {
    return localStorage.getItem(MATCH_FRAME_RATE_KEY) !== "false";
  } catch {
    return true;
  }
}

export const saveMatchFrameRate = (on: boolean) => writeValue(localStorage, MATCH_FRAME_RATE_KEY, String(on));

const SKIP_KEY = "argent.autoSkip";

/** Skip intros and credits automatically (this device). */
export function readAutoSkip(): { intro: boolean; credits: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY) || "{}");
    return { intro: v.intro === true, credits: v.credits === true };
  } catch {
    return { intro: false, credits: false };
  }
}

export const saveAutoSkip = (value: { intro: boolean; credits: boolean }) => writeValue(localStorage, SKIP_KEY, JSON.stringify(value));

const PAUSE_INFO_KEY = "argent.pauseInfo";

/** After a few seconds paused, dim the picture and show what's playing (this device). */
export function readPauseInfo(): boolean {
  try {
    return localStorage.getItem(PAUSE_INFO_KEY) !== "false";
  } catch {
    return true;
  }
}

export const savePauseInfo = (on: boolean) => writeValue(localStorage, PAUSE_INFO_KEY, String(on));

const SOUND_KEY = "argent.sound";

/** Dialogue boost and volume levelling (this device); also passed to the native players. */
export function readSound(): { dialogue: boolean; level: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(SOUND_KEY) || "{}");
    return { dialogue: v.dialogue === true, level: v.level === true };
  } catch {
    return { dialogue: false, level: false };
  }
}

export const saveSound = (value: { dialogue: boolean; level: boolean }) => writeValue(localStorage, SOUND_KEY, JSON.stringify(value));
