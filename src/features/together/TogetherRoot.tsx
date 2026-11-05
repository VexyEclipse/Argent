import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { onSocketConnection, onSocketMessage, startSocket, stopSocket } from "@/api/socket";
import { reportCapabilities, syncPlay, type GroupInfo } from "@/api/sessions";
import { showToast } from "@/components/Toast";
import { logEvent } from "@/features/diagnostics/log";
import { sendPlayerCommand } from "@/features/player/commands";
import { getTogether, setState, syncClock, type QueueItem } from "./store";
import type { SyncCommand } from "./syncLogic";

const TICKS = 10_000_000;

interface PlayRequest {
  ItemIds: string[];
  StartPositionTicks?: number;
  PlayCommand?: string;
  StartIndex?: number;
  MediaSourceId?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
}

interface PlaystateRequest {
  Command: string;
  SeekPositionTicks?: number;
}

interface GeneralCommand {
  Name: string;
  Arguments?: Record<string, string>;
}

interface GroupUpdate {
  GroupId: string;
  Type: string;
  Data: unknown;
}

interface PlayQueueUpdate {
  Reason: string;
  Playlist: QueueItem[];
  PlayingItemIndex: number;
  StartPositionTicks: number;
  IsPlaying: boolean;
}

/** URL of the player for an item started by the group or another device ("here" skips "Play on"). */
export function playUrl(itemId: string, startTicks: number, extra: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams({ start: String(Math.round(startTicks / TICKS)), here: "1" });
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) q.set(k, String(v));
  return `/play/${itemId}?${q}`;
}

/**
 * The server's line to this device while signed in: being controlled from another device
 * (play, pause, seek, volume, tracks, messages) and Watch Together group updates.
 */
export function TogetherRoot() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    startSocket();
    const offs = [
      onSocketConnection((open) => {
        if (!open) return;
        reportCapabilities().catch((e) => logEvent("remote", `Couldn't report capabilities: ${e instanceof Error ? e.message : e}`, "warn"));
        // A reconnect (sleep, network change) may have dropped this device from its group.
        if (getTogether().group) syncClock();
      }),

      // ---- remote control ------------------------------------------------------------
      onSocketMessage<PlayRequest>("Play", (d) => {
        const id = d.ItemIds?.[d.StartIndex ?? 0];
        if (!id) return;
        logEvent("remote", `Play ${id} requested by another device`);
        nav.current(
          playUrl(id, d.StartPositionTicks ?? 0, {
            version: d.MediaSourceId,
            audio: d.AudioStreamIndex,
            subtitle: d.SubtitleStreamIndex,
          }),
        );
      }),
      onSocketMessage<PlaystateRequest>("Playstate", (d) => {
        const map: Record<string, Parameters<typeof sendPlayerCommand>[0]> = {
          Stop: { kind: "stop" },
          Pause: { kind: "pause" },
          Unpause: { kind: "unpause" },
          PlayPause: { kind: "toggle" },
          NextTrack: { kind: "next" },
          PreviousTrack: { kind: "previous" },
          Rewind: { kind: "seekBy", seconds: -10 },
          FastForward: { kind: "seekBy", seconds: 30 },
        };
        const command = d.Command === "Seek" ? { kind: "seek" as const, seconds: (d.SeekPositionTicks ?? 0) / TICKS } : map[d.Command];
        if (command) sendPlayerCommand(command);
      }),
      onSocketMessage<GeneralCommand>("GeneralCommand", (d) => {
        const a = d.Arguments ?? {};
        switch (d.Name) {
          case "SetVolume":
            sendPlayerCommand({ kind: "volume", value: Number(a.Volume ?? 100) / 100 });
            break;
          case "Mute":
          case "Unmute":
          case "ToggleMute":
            sendPlayerCommand({ kind: "mute", muted: d.Name === "ToggleMute" ? undefined : d.Name === "Mute" });
            break;
          case "SetAudioStreamIndex":
            sendPlayerCommand({ kind: "audio", index: Number(a.Index) });
            break;
          case "SetSubtitleStreamIndex":
            sendPlayerCommand({ kind: "subtitle", index: Number(a.Index) });
            break;
          case "DisplayMessage":
            showToast([a.Header, a.Text].filter(Boolean).join(": "));
            break;
          case "GoHome":
            nav.current("/");
            break;
          case "Back":
            window.history.back();
            break;
        }
      }),

      // ---- Watch Together ------------------------------------------------------------
      onSocketMessage<GroupUpdate>("SyncPlayGroupUpdate", (u) => {
        switch (u.Type) {
          case "GroupJoined": {
            const group = u.Data as GroupInfo;
            setState({ group });
            showToast(`Watching together in ${group.GroupName}`);
            logEvent("together", `Joined group ${group.GroupName}`);
            break;
          }
          case "GroupLeft":
          case "NotInGroup":
            if (getTogether().group) showToast("You left the group");
            setState({ group: null, queue: [], command: null });
            break;
          case "UserJoined":
          case "UserLeft": {
            const name = String(u.Data);
            const g = getTogether().group;
            if (g) {
              const others = g.Participants.filter((p) => p !== name);
              setState({ group: { ...g, Participants: u.Type === "UserJoined" ? [...others, name] : others } });
            }
            showToast(`${name} ${u.Type === "UserJoined" ? "joined" : "left"}`);
            break;
          }
          case "StateUpdate": {
            const g = getTogether().group;
            const s = (u.Data as { State: GroupInfo["State"] }).State;
            if (g) setState({ group: { ...g, State: s } });
            break;
          }
          case "PlayQueue": {
            const q = u.Data as PlayQueueUpdate;
            const before = getTogether();
            const item = q.Playlist[q.PlayingItemIndex];
            setState({ queue: q.Playlist, playingIndex: q.PlayingItemIndex, startSeconds: q.StartPositionTicks / TICKS });
            const changed = before.queue[before.playingIndex]?.PlaylistItemId !== item?.PlaylistItemId;
            if (item && (changed || ["NewPlaylist", "SetCurrentItem", "NextItem", "PreviousItem"].includes(q.Reason))) {
              nav.current(playUrl(item.ItemId, q.StartPositionTicks, { together: item.PlaylistItemId }), { replace: location.pathname.startsWith("/play/") });
            }
            break;
          }
          case "GroupDoesNotExist":
            showToast("That group no longer exists");
            setState({ group: null, queue: [], command: null });
            break;
          case "LibraryAccessDenied":
            showToast("Someone in the group can't access this title");
            break;
        }
        queryClient.invalidateQueries({ queryKey: ["syncplay", "groups"] });
      }),
      onSocketMessage<SyncCommand>("SyncPlayCommand", (c) => {
        setState({ command: c });
        if (c.Command === "Stop") sendPlayerCommand({ kind: "stop" });
      }),
    ];

    // Tell the group how far away this device is, so it schedules with room to spare.
    const ping = window.setInterval(() => {
      const s = getTogether();
      if (s.group) syncPlay.ping(s.rttMs).catch(() => {});
    }, 10_000);
    const resync = window.setInterval(() => getTogether().group && syncClock(), 60_000);

    return () => {
      offs.forEach((off) => off());
      window.clearInterval(ping);
      window.clearInterval(resync);
      stopSocket();
    };
  }, [queryClient]);

  return null;
}
