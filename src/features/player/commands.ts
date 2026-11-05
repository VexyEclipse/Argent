// Commands for whichever player is open: from the desktop tray, from another device
// controlling this one (remote control), or from a Watch Together group. The open
// player registers one handler; with no player open, commands are dropped.

import { useEffect, useRef } from "react";

export type PlayerCommand =
  | { kind: "toggle" }
  | { kind: "pause" }
  | { kind: "unpause" }
  | { kind: "stop" }
  | { kind: "next" }
  | { kind: "previous" }
  /** Absolute position, seconds. */
  | { kind: "seek"; seconds: number }
  | { kind: "seekBy"; seconds: number }
  /** 0–1 */
  | { kind: "volume"; value: number }
  | { kind: "mute"; muted?: boolean }
  | { kind: "audio"; index: number }
  | { kind: "subtitle"; index: number };

let handler: ((c: PlayerCommand) => void) | null = null;

/** Whether a player took the command. */
export function sendPlayerCommand(command: PlayerCommand): boolean {
  if (!handler) return false;
  handler(command);
  return true;
}

export const playerIsOpen = () => handler !== null;

/** The open player's handler; the latest closure is always used. */
export function usePlayerCommands(fn: (c: PlayerCommand) => void, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const own = (c: PlayerCommand) => ref.current(c);
    handler = own;
    return () => {
      if (handler === own) handler = null;
    };
  }, [enabled]);
}
