// Players outside the page: the Android app's native Media3 player (HDR, Dolby Vision,
// surround passthrough, refresh-rate matching) and mpv in the desktop app. Each is
// offered only where it exists and the viewer hasn't switched it off.

import { androidApp, nativeCapabilities, onNativeEvent } from "@/platform/android";
import { desktop } from "@/platform/desktop";
import type { PlayerCommand } from "./commands";
import { mpvProfile, nativeProfile, type ExternalRequest, type ExternalResult, type ExternalState } from "./externalPlan";
import { readEngine } from "./prefs";

export interface ExternalEngine {
  /** Shown to the viewer: "the Android player", "mpv". */
  name: string;
  profile(maxBitrate: number): Record<string, unknown>;
  play(request: ExternalRequest, onState: (s: ExternalState) => void): Promise<ExternalResult>;
  control(command: PlayerCommand): void;
}

function androidEngine(): ExternalEngine | null {
  const app = androidApp;
  const caps = nativeCapabilities();
  if (!app?.play || !caps) return null;
  return {
    name: "the Android player",
    profile: (maxBitrate) => nativeProfile(caps, maxBitrate),
    play: (request, onState) =>
      new Promise((resolve) => {
        const off = onNativeEvent<{ type: string } & ExternalResult>((d) => {
          if (d.type === "state") onState(d);
          else if (d.type === "result") {
            off();
            resolve(d);
          }
        });
        app.play!(JSON.stringify(request));
      }),
    control: (command) => app.control?.(JSON.stringify(command)),
  };
}

function mpvEngine(): ExternalEngine | null {
  const d = desktop;
  if (!d?.playExternal) return null;
  return {
    name: "mpv",
    profile: mpvProfile,
    play: async (request, onState) => {
      const off = d.onExternalState?.((s) => onState(s as ExternalState));
      try {
        return (await d.playExternal!(request)) as ExternalResult;
      } finally {
        off?.();
      }
    },
    control: (command) => d.controlExternal?.(command),
  };
}

/** The player to hand playback to, or null to play in the page. */
export async function externalEngine(): Promise<ExternalEngine | null> {
  if (readEngine() === "web") return null;
  if (androidApp) return androidEngine();
  if (desktop?.playExternal) {
    const info = await desktop.getInfo();
    return info.settings.useMpv && info.mpv ? mpvEngine() : null;
  }
  return null;
}

/** Whether this device has a native player at all (for the setting). */
export const hasNativePlayer = () => Boolean(androidApp?.play && nativeCapabilities());
