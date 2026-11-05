// Jellyfin's WebSocket (/socket): how the server reaches this device for remote control
// ("Play", "Playstate", "GeneralCommand") and Watch Together ("SyncPlay…"). One
// connection per signed-in session; it reconnects by itself and keeps itself alive.

import { logEvent } from "@/features/diagnostics/log";
import { client } from "./jellyfin";

export interface SocketMessage<T = unknown> {
  MessageType: string;
  Data?: T;
  MessageId?: string;
}

type Handler = (data: unknown) => void;

const handlers = new Map<string, Set<Handler>>();
const connectionListeners = new Set<(open: boolean) => void>();
let ws: WebSocket | null = null;
let wanted = false;
let retryMs = 2000;
let retryTimer = 0;
let keepAliveTimer = 0;
let isOpen = false;

export function socketUrl(serverUrl: string, token: string, deviceId: string): string {
  const url = new URL(`${serverUrl.replace(/\/+$/, "")}/socket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("api_key", token);
  url.searchParams.set("deviceId", deviceId);
  return url.toString();
}

function setOpen(open: boolean) {
  if (isOpen === open) return;
  isOpen = open;
  connectionListeners.forEach((fn) => fn(open));
}

function send(message: SocketMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connect() {
  const c = client();
  if (!c.accessToken) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(socketUrl(c.serverUrl, c.accessToken, c.deviceId));
  } catch (e) {
    logEvent("socket", `Couldn't open: ${e instanceof Error ? e.message : e}`, "warn");
    scheduleRetry();
    return;
  }
  ws = socket;
  socket.onopen = () => {
    retryMs = 2000;
    setOpen(true);
    logEvent("socket", "Connected");
  };
  socket.onmessage = (event) => {
    let message: SocketMessage;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.MessageType === "ForceKeepAlive") {
      // The server drops a socket that stays quiet for this many seconds.
      const seconds = Number(message.Data) || 60;
      window.clearInterval(keepAliveTimer);
      keepAliveTimer = window.setInterval(() => send({ MessageType: "KeepAlive" }), (seconds * 1000) / 2);
      send({ MessageType: "KeepAlive" });
      return;
    }
    handlers.get(message.MessageType)?.forEach((fn) => {
      try {
        fn(message.Data);
      } catch (e) {
        logEvent("socket", `${message.MessageType} handler failed: ${e instanceof Error ? e.message : e}`, "error");
      }
    });
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    window.clearInterval(keepAliveTimer);
    setOpen(false);
    scheduleRetry();
  };
  socket.onerror = () => {
    /* followed by close */
  };
}

function scheduleRetry() {
  if (!wanted) return;
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, 30_000);
}

export function startSocket() {
  if (wanted) return;
  wanted = true;
  connect();
}

export function stopSocket() {
  wanted = false;
  window.clearTimeout(retryTimer);
  window.clearInterval(keepAliveTimer);
  const s = ws;
  ws = null;
  s?.close();
  setOpen(false);
}

export function onSocketMessage<T>(type: string, fn: (data: T) => void): () => void {
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  const h = fn as Handler;
  set.add(h);
  return () => {
    set!.delete(h);
  };
}

export function onSocketConnection(fn: (open: boolean) => void): () => void {
  connectionListeners.add(fn);
  return () => {
    connectionListeners.delete(fn);
  };
}

export const socketIsOpen = () => isOpen;
