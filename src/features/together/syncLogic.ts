// Pure Watch Together (SyncPlay) maths: the offset between this device's clock and the
// server's, where a group's playback should be at a given moment, and how to correct
// drift. Covered by syncLogic.test.ts.

export interface ClockSample {
  /** Local ms when the request was sent and the response arrived. */
  sentAt: number;
  receivedAt: number;
  /** Server ms when it received the request and sent the response. */
  serverReceived: number;
  serverSent: number;
}

/** NTP's estimate: server time = local time + offset. Delay is the network round trip. */
export function sampleOffset(s: ClockSample): { offset: number; delay: number } {
  return {
    offset: (s.serverReceived - s.sentAt + (s.serverSent - s.receivedAt)) / 2,
    delay: s.receivedAt - s.sentAt - (s.serverSent - s.serverReceived),
  };
}

/** The sample with the shortest round trip is the most trustworthy. */
export function bestOffset(samples: readonly ClockSample[]): { offset: number; delay: number } | null {
  if (!samples.length) return null;
  return samples.map(sampleOffset).reduce((best, s) => (s.delay < best.delay ? s : best));
}

export interface SyncCommand {
  Command: "Unpause" | "Pause" | "Stop" | "Seek";
  /** Server time (ISO) at which the command takes effect. */
  When: string;
  PositionTicks: number;
  PlaylistItemId: string;
}

const TICKS = 10_000;

/** Local ms at which a server time arrives on this device. */
export const toLocal = (serverIso: string, offsetMs: number) => Date.parse(serverIso) - offsetMs;

/** Where the group's playback is (seconds) at local time `now`, given its last command. */
export function groupPosition(command: SyncCommand, offsetMs: number, now: number): number {
  const base = command.PositionTicks / TICKS / 1000;
  if (command.Command !== "Unpause") return base;
  return base + Math.max(0, now - toLocal(command.When, offsetMs)) / 1000;
}

export type DriftFix = { kind: "none" } | { kind: "rate"; rate: number } | { kind: "seek"; to: number };

/**
 * Small drift is evened out by playing slightly faster or slower, which nobody notices;
 * a big one is a seek.
 */
export function driftFix(actual: number, expected: number): DriftFix {
  const diff = actual - expected;
  if (Math.abs(diff) < 0.12) return { kind: "none" };
  if (Math.abs(diff) > 1.5) return { kind: "seek", to: expected };
  return { kind: "rate", rate: diff > 0 ? 0.95 : 1.05 };
}
