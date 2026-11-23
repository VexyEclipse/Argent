// Playing on a Chromecast through Jellyfin's own Cast receiver app. Argent launches the
// receiver on the device and hands it the server address and this user's token; the
// receiver then asks the server for the stream (with its own device profile) and reports
// playback as a session of its own, so resume points and the server dashboard stay right.
// Controls go to the receiver over the Cast channel: it has no websocket, so the server's
// remote-control commands can't reach it.

import { useEffect, useState } from "react";
import type { BaseItem, PublicSystemInfo } from "@/api/types";
import { client, getMe, getPublicInfo } from "@/api/jellyfin";
import { logEvent } from "@/features/diagnostics/log";
import { castBridge, type CastDevice } from "./bridge";

/** Jellyfin's stable receiver, used when the server doesn't name one for the user. */
const DEFAULT_RECEIVER = "F007D354";
export const RECEIVER_NAMESPACE = "urn:x-cast:com.connectsdk";
/** The client name the receiver reports to the server. */
export const RECEIVER_CLIENT = "Chromecast";

let receiverId: Promise<string> | null = null;

/** The receiver app the server's user settings name (Jellyfin 10.9+), else the stable one. */
export function receiverAppId(): Promise<string> {
  receiverId ??= getMe(client())
    .then((me) => (me.Configuration as { CastReceiverId?: string } | undefined)?.CastReceiverId || DEFAULT_RECEIVER)
    .catch(() => DEFAULT_RECEIVER);
  return receiverId;
}

/** The device id the receiver registers with the server (it derives it from its name). */
export function receiverDeviceId(name: string) {
  try {
    return btoa(name.replace(/[^\w\s]/gi, ""));
  } catch {
    return "";
  }
}

const publicInfo = new Map<string, Promise<PublicSystemInfo | null>>();
const serverInfo = () => {
  const c = client();
  if (!publicInfo.has(c.serverUrl)) publicInfo.set(c.serverUrl, getPublicInfo(c).catch(() => null));
  return publicInfo.get(c.serverUrl)!;
};

/** The server as the TV reaches it: never localhost, which would be the TV itself. */
async function serverAddressForTv() {
  const c = client();
  const host = new URL(c.serverUrl).hostname;
  if (host === "localhost" || host.startsWith("127.") || host === "[::1]") {
    const info = await serverInfo();
    if (info?.LocalAddress) return info.LocalAddress.replace(/\/+$/, "");
  }
  return c.serverUrl;
}

export type ReceiverCommand =
  | "Identify"
  | "PlayNow"
  | "Pause"
  | "Unpause"
  | "PlayPause"
  | "Stop"
  | "Seek"
  | "NextTrack"
  | "PreviousTrack"
  | "SetAudioStreamIndex"
  | "SetSubtitleStreamIndex";

/** Sends a command to the receiver on device, with what it needs to reach the server. */
export async function castCommand(device: Pick<CastDevice, "id" | "name">, command: ReceiverCommand, options: Record<string, unknown> = {}) {
  if (!castBridge) throw new Error("Casting isn't available here");
  const c = client();
  const appId = await receiverAppId();
  const info = await serverInfo();
  const message = {
    command,
    options,
    userId: c.userId,
    deviceId: c.deviceId,
    accessToken: c.accessToken,
    serverAddress: await serverAddressForTv(),
    serverId: info?.Id,
    serverVersion: info?.Version,
    receiverName: device.name,
  };
  await castBridge.send(device.id, RECEIVER_NAMESPACE, JSON.stringify(message), appId);
}

/** Starts the receiver on device (its waiting screen shows), or joins it if it's running. */
export async function castConnect(device: Pick<CastDevice, "id" | "name">) {
  if (!castBridge) throw new Error("Casting isn't available here");
  await castBridge.launch(device.id, await receiverAppId());
  await castCommand(device, "Identify");
  logEvent("cast", `Connected to ${device.name}`);
}

/** Plays item on device from startTicks. */
export async function castPlay(device: Pick<CastDevice, "id" | "name">, item: BaseItem, startTicks: number, mediaSourceId?: string) {
  if (!castBridge) throw new Error("Casting isn't available here");
  await castBridge.launch(device.id, await receiverAppId());
  await castCommand(device, "PlayNow", {
    items: [{ Id: item.Id, ServerId: item.ServerId, Name: item.Name, Type: item.Type, MediaType: item.MediaType ?? "Video", IsFolder: false }],
    startPositionTicks: startTicks,
    ...(mediaSourceId ? { mediaSourceId } : {}),
  });
  logEvent("cast", `Sent ${item.Id} to ${device.name}`);
}

/** Closes the receiver on device. */
export async function castDisconnect(device: Pick<CastDevice, "id" | "name">) {
  await castBridge?.stop(device.id);
  logEvent("cast", `Disconnected from ${device.name}`);
}

/** Cast devices on the network, kept current while mounted. Empty where Cast isn't available. */
export function useCastDevices(): CastDevice[] {
  const [devices, setDevices] = useState<CastDevice[]>([]);
  useEffect(() => {
    if (!castBridge) return;
    const bridge = castBridge;
    let live = true;
    const scan = () =>
      bridge
        .scan()
        .then((d) => live && setDevices(d))
        .catch(() => {});
    scan();
    // A scan runs for a minute; keep it going while the list is on screen.
    const timer = window.setInterval(scan, 45_000);
    const off = bridge.onDevices((d) => live && setDevices(d));
    return () => {
      live = false;
      window.clearInterval(timer);
      off();
    };
  }, []);
  return devices;
}
