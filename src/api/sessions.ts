// Sessions (other devices, remote control) and SyncPlay (Watch Together) endpoints.

import type { BaseItem } from "./types";
import { client } from "./jellyfin";

export interface SessionInfo {
  Id: string;
  UserId?: string;
  UserName?: string;
  Client?: string;
  DeviceId?: string;
  DeviceName?: string;
  ApplicationVersion?: string;
  LastActivityDate?: string;
  SupportsRemoteControl?: boolean;
  SupportsMediaControl?: boolean;
  NowPlayingItem?: BaseItem;
  PlayState?: {
    PositionTicks?: number;
    IsPaused?: boolean;
    IsMuted?: boolean;
    VolumeLevel?: number;
    AudioStreamIndex?: number;
    SubtitleStreamIndex?: number;
    MediaSourceId?: string;
    PlayMethod?: string;
  };
  Capabilities?: { PlayableMediaTypes?: string[]; SupportedCommands?: string[]; SupportsMediaControl?: boolean };
}

/** What this device can do when another one controls it. */
export const OWN_COMMANDS = [
  "SetVolume",
  "Mute",
  "Unmute",
  "ToggleMute",
  "VolumeUp",
  "VolumeDown",
  "SetAudioStreamIndex",
  "SetSubtitleStreamIndex",
  "DisplayMessage",
  "GoHome",
  "Back",
  "PlayState",
  "Play",
];

export const reportCapabilities = () =>
  client().request<void>("/Sessions/Capabilities/Full", {
    method: "POST",
    body: { PlayableMediaTypes: ["Video", "Audio"], SupportedCommands: OWN_COMMANDS, SupportsMediaControl: true, SupportsPersistentIdentifier: true },
  });

/** Devices this user may control, active in the last quarter hour. */
export const getControllableSessions = () =>
  client().request<SessionInfo[]>("/Sessions", { query: { controllableByUserId: client().userId, activeWithinSeconds: 960 } });

export const getSessionById = async (deviceId: string) => (await client().request<SessionInfo[]>("/Sessions", { query: { deviceId } }))[0] ?? null;

export const remotePlay = (sessionId: string, itemIds: string[], startPositionTicks = 0, mediaSourceId?: string) =>
  client().request<void>(`/Sessions/${sessionId}/Playing`, {
    method: "POST",
    query: { playCommand: "PlayNow", itemIds, startPositionTicks, mediaSourceId },
  });

export type PlaystateCommand = "Stop" | "Pause" | "Unpause" | "PlayPause" | "NextTrack" | "PreviousTrack" | "Seek" | "Rewind" | "FastForward";

export const remotePlaystate = (sessionId: string, command: PlaystateCommand, seekPositionTicks?: number) =>
  client().request<void>(`/Sessions/${sessionId}/Playing/${command}`, { method: "POST", query: { seekPositionTicks } });

export const remoteCommand = (sessionId: string, name: string, args?: Record<string, string>) =>
  client().request<void>(`/Sessions/${sessionId}/Command`, { method: "POST", body: { Name: name, Arguments: args ?? {} } });

// ---- SyncPlay -------------------------------------------------------------------------

export interface GroupInfo {
  GroupId: string;
  GroupName: string;
  State: "Idle" | "Waiting" | "Paused" | "Playing";
  Participants: string[];
  LastUpdatedAt?: string;
}

export interface UtcTime {
  RequestReceptionTime: string;
  ResponseTransmissionTime: string;
}

const sp = <T = void>(path: string, body?: unknown, method: "GET" | "POST" = "POST") => client().request<T>(`/SyncPlay/${path}`, { method, body });

export const syncPlay = {
  list: () => sp<GroupInfo[]>("List", undefined, "GET"),
  create: (name: string) => sp<GroupInfo | undefined>("New", { GroupName: name }),
  join: (groupId: string) => sp("Join", { GroupId: groupId }),
  leave: () => sp("Leave"),
  setQueue: (itemIds: string[], startPositionTicks = 0) => sp("SetNewQueue", { PlayingQueue: itemIds, PlayingItemPosition: 0, StartPositionTicks: startPositionTicks }),
  pause: () => sp("Pause"),
  unpause: () => sp("Unpause"),
  stop: () => sp("Stop"),
  seek: (positionTicks: number) => sp("Seek", { PositionTicks: Math.round(positionTicks) }),
  nextItem: (playlistItemId: string) => sp("NextItem", { PlaylistItemId: playlistItemId }),
  previousItem: (playlistItemId: string) => sp("PreviousItem", { PlaylistItemId: playlistItemId }),
  buffering: (when: Date, positionTicks: number, isPlaying: boolean, playlistItemId: string) =>
    sp("Buffering", { When: when.toISOString(), PositionTicks: Math.round(positionTicks), IsPlaying: isPlaying, PlaylistItemId: playlistItemId }),
  ready: (when: Date, positionTicks: number, isPlaying: boolean, playlistItemId: string) =>
    sp("Ready", { When: when.toISOString(), PositionTicks: Math.round(positionTicks), IsPlaying: isPlaying, PlaylistItemId: playlistItemId }),
  ping: (ms: number) => sp("Ping", { Ping: Math.round(ms) }),
};

export const getUtcTime = () => client().request<UtcTime>("/GetUtcTime");
