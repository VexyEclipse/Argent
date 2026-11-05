// Playing a download: the stream is the saved file (and its subtitle files) on this device,
// and progress goes into the download's own watch state instead of the server.

import { randomId } from "@/api/client";
import type { StreamInfo } from "@/features/player/playback";
import type { ReportState } from "@/features/player/reporter";
import type { DownloadRecord } from "./logic";
import { fileUrl, saveOfflineProgress, syncOfflineProgress } from "./store";

const TICKS = 10_000_000;

export async function offlineStream(r: DownloadRecord): Promise<StreamInfo> {
  const url = await fileUrl(r.files.video, r.files.mime);
  if (!url) throw new Error("This download is missing from the device. Delete it and download it again.");
  const tracks = await Promise.all(
    r.files.subtitles.map(async (s) => {
      const u = await fileUrl(s.file, "text/vtt");
      return u ? { index: s.index, label: s.label, language: s.language, url: u } : null;
    }),
  );
  const source = r.item.MediaSources![0];
  return {
    url,
    hls: false,
    method: "DirectPlay",
    source,
    versions: [source],
    playSessionId: `offline-${randomId()}`,
    audioIndex: r.audioIndex,
    subtitleIndex: r.subtitleIndex,
    transcodeReasons: [],
    textTracks: tracks.filter((t) => t !== null),
    assTracks: [],
    fonts: [],
    offline: true,
  };
}

/** The player's reporter for a download: saves your place every 10 seconds and on pause or stop. */
export class OfflineReporter {
  private timer = 0;
  private active = false;

  constructor(
    private readonly id: string,
    private readonly read: () => ReportState,
  ) {}

  private save() {
    if (this.active) saveOfflineProgress(this.id, Math.round(this.read().positionSeconds * TICKS));
  }

  async start() {
    this.active = true;
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.save(), 10_000);
  }

  async progress() {
    this.save();
  }

  nudge() {}

  updateStreams() {}

  async stop() {
    if (!this.active) return;
    window.clearInterval(this.timer);
    this.save();
    this.active = false;
    syncOfflineProgress();
  }
}
