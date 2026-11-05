// Watch Together (Jellyfin SyncPlay) and "Play on" state for this device: the group it's
// in, the group's queue and last playback command, the server clock offset, and which
// other device (if any) Play buttons send to.

import { useSyncExternalStore } from "react";
import { getUtcTime, syncPlay, type GroupInfo, type SessionInfo } from "@/api/sessions";
import { logEvent } from "@/features/diagnostics/log";
import { bestOffset, type ClockSample, type SyncCommand } from "./syncLogic";

export interface QueueItem {
  ItemId: string;
  PlaylistItemId: string;
}

export interface TogetherState {
  group: GroupInfo | null;
  queue: QueueItem[];
  playingIndex: number;
  /** The queue's start position when it was set (seconds). */
  startSeconds: number;
  command: SyncCommand | null;
  /** Server time = local time + offset (ms). */
  offsetMs: number;
  /** Round trip to the server (ms), reported to the group so it can allow for it. */
  rttMs: number;
  /** The device Play buttons send to, instead of playing here. */
  target: Pick<SessionInfo, "Id" | "DeviceName" | "Client" | "DeviceId"> | null;
}

let state: TogetherState = { group: null, queue: [], playingIndex: 0, startSeconds: 0, command: null, offsetMs: 0, rttMs: 0, target: readTarget() };
const listeners = new Set<() => void>();

function readTarget(): TogetherState["target"] {
  try {
    return JSON.parse(sessionStorage.getItem("argent.playTarget") || "null");
  } catch {
    return null;
  }
}

export function setState(patch: Partial<TogetherState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export const getTogether = () => state;

export function subscribeTogether(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useTogether = () => useSyncExternalStore(subscribeTogether, getTogether);

/** Play buttons send to this device until cleared (for this tab only). */
export function setPlayTarget(target: TogetherState["target"]) {
  try {
    if (target) sessionStorage.setItem("argent.playTarget", JSON.stringify(target));
    else sessionStorage.removeItem("argent.playTarget");
  } catch {
    /* ignore */
  }
  setState({ target });
}

export const currentQueueItem = (s = state): QueueItem | undefined => s.queue[s.playingIndex];

// ---- clock ----------------------------------------------------------------------------

let syncing: Promise<void> | null = null;

/** Measures the server clock offset from a few quick round trips. */
export function syncClock(): Promise<void> {
  syncing ??= (async () => {
    const samples: ClockSample[] = [];
    for (let i = 0; i < 5; i++) {
      const sentAt = Date.now();
      try {
        const t = await getUtcTime();
        const receivedAt = Date.now();
        samples.push({ sentAt, receivedAt, serverReceived: Date.parse(t.RequestReceptionTime), serverSent: Date.parse(t.ResponseTransmissionTime) });
      } catch {
        /* try the next one */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    const best = bestOffset(samples);
    if (best) {
      setState({ offsetMs: best.offset, rttMs: Math.max(0, best.delay) });
      logEvent("together", `Clock offset ${Math.round(best.offset)} ms, round trip ${Math.round(best.delay)} ms`);
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export const serverNow = () => new Date(Date.now() + state.offsetMs);

// ---- group actions --------------------------------------------------------------------

export async function createGroup(name: string) {
  await syncClock();
  await syncPlay.create(name);
}

export async function joinGroup(groupId: string) {
  await syncClock();
  await syncPlay.join(groupId);
}

export async function leaveGroup() {
  try {
    await syncPlay.leave();
  } finally {
    setState({ group: null, queue: [], command: null });
  }
}
