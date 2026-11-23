// Google Cast (Chromecast) through the app shells: the desktop app's electron/cast.cjs
// and the Android app's CastBridge.java speak the Cast protocol; the page sees one small
// API. Null in a browser (Safari has no Cast, and Chrome's sender SDK needs https) and in
// app versions from before Cast.

import { desktop } from "@/platform/desktop";
import { androidApp, onNativeEvent } from "@/platform/android";

export interface CastDevice {
  id: string;
  name: string;
  /** "Chromecast", "Google TV Streamer", "Google Cast Group"… */
  model: string;
}

export interface CastStatus {
  id: string;
  /** The control channel to the device is open. */
  connected: boolean;
  /** The receiver app Argent has joined, if any. */
  appId: string | null;
  /** The device's own volume (0–1). */
  volume: { level: number; muted: boolean } | null;
}

export interface CastMessage {
  id: string;
  namespace: string;
  /** As the receiver sent it (usually JSON). */
  data: string;
}

export interface CastBridge {
  /** Looks for devices for a minute; resolves with those known so far. */
  scan(): Promise<CastDevice[]>;
  /** Starts the receiver app (or joins it if it's running). */
  launch(id: string, appId: string): Promise<CastStatus>;
  /** Sends a JSON string to the receiver app; with appId, rejoins it after a reconnect. */
  send(id: string, namespace: string, payload: string, appId?: string): Promise<void>;
  volume(id: string, volume: { level?: number; muted?: boolean }): Promise<void>;
  status(id: string): Promise<CastStatus>;
  /** Closes the receiver app and lets the device go. */
  stop(id: string): Promise<void>;
  onDevices(fn: (devices: CastDevice[]) => void): () => void;
  onMessage(fn: (message: CastMessage) => void): () => void;
  onStatus(fn: (status: CastStatus) => void): () => void;
}

interface DesktopCast {
  castScan(): Promise<CastDevice[]>;
  castLaunch(id: string, appId: string): Promise<CastStatus>;
  castSend(id: string, namespace: string, payload: string, appId?: string): Promise<void>;
  castVolume(id: string, volume: { level?: number; muted?: boolean }): Promise<void>;
  castStatus(id: string): Promise<CastStatus>;
  castStop(id: string): Promise<void>;
  onCastDevices(fn: (devices: CastDevice[]) => void): () => void;
  onCastMessage(fn: (message: CastMessage) => void): () => void;
  onCastStatus(fn: (status: CastStatus) => void): () => void;
}

interface AndroidCast {
  castScan(): string;
  castLaunch(requestId: string, id: string, appId: string): void;
  castSend(requestId: string, id: string, namespace: string, payload: string, appId: string): void;
  castVolume(requestId: string, id: string, volume: string): void;
  castStatus(requestId: string, id: string): void;
  castStop(requestId: string, id: string): void;
}

function fromDesktop(d: DesktopCast): CastBridge {
  return {
    scan: () => d.castScan(),
    launch: (id, appId) => d.castLaunch(id, appId),
    send: (id, namespace, payload, appId) => d.castSend(id, namespace, payload, appId),
    volume: (id, volume) => d.castVolume(id, volume),
    status: (id) => d.castStatus(id),
    stop: (id) => d.castStop(id),
    onDevices: (fn) => d.onCastDevices(fn),
    onMessage: (fn) => d.onCastMessage(fn),
    onStatus: (fn) => d.onCastStatus(fn),
  };
}

type AndroidEvent =
  | { type: "castReply"; requestId: string; ok: boolean; result?: unknown; error?: string }
  | ({ type: "castDevices" } & { devices: CastDevice[] })
  | ({ type: "castMessage" } & CastMessage)
  | ({ type: "castStatus" } & CastStatus);

function fromAndroid(a: AndroidCast): CastBridge {
  let next = 1;
  const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  onNativeEvent<AndroidEvent>((e) => {
    if (e.type !== "castReply") return;
    const w = waiting.get(e.requestId);
    if (!w) return;
    waiting.delete(e.requestId);
    if (e.ok) w.resolve(e.result ?? undefined);
    else w.reject(new Error(e.error || "The device didn't respond"));
  });
  const call = <T>(fn: (requestId: string) => void) =>
    new Promise<T>((resolve, reject) => {
      const requestId = String(next++);
      waiting.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      fn(requestId);
    });
  const on =
    <K extends AndroidEvent["type"]>(type: K, map: (e: Extract<AndroidEvent, { type: K }>) => void) =>
    () =>
      onNativeEvent<AndroidEvent>((e) => {
        if (e.type === type) map(e as Extract<AndroidEvent, { type: K }>);
      });
  return {
    scan: async () => JSON.parse(a.castScan() || "[]") as CastDevice[],
    launch: (id, appId) => call((r) => a.castLaunch(r, id, appId)),
    send: (id, namespace, payload, appId) => call((r) => a.castSend(r, id, namespace, payload, appId ?? "")),
    volume: (id, volume) => call((r) => a.castVolume(r, id, JSON.stringify(volume))),
    status: (id) => call((r) => a.castStatus(r, id)),
    stop: (id) => call((r) => a.castStop(r, id)),
    onDevices: (fn) => on("castDevices", (e) => fn(e.devices))(),
    onMessage: (fn) => on("castMessage", ({ id, namespace, data }) => fn({ id, namespace, data }))(),
    onStatus: (fn) => on("castStatus", ({ id, connected, appId, volume }) => fn({ id, connected, appId, volume }))(),
  };
}

const desktopCast = desktop as unknown as Partial<DesktopCast> | null;
const androidCast = androidApp as unknown as Partial<AndroidCast> | null;

export const castBridge: CastBridge | null = desktopCast?.castScan
  ? fromDesktop(desktopCast as DesktopCast)
  : androidCast?.castScan
    ? fromAndroid(androidCast as AndroidCast)
    : null;
