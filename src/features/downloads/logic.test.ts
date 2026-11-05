import { describe, expect, it } from "vitest";
import type { BaseItem, MediaSource } from "@/api/types";
import { estimateBytes, formatBytes, groupDownloads, offlineItem, offlineNeighbours, offlineStart, percentOf, videoFileType, watchedAt, type DownloadRecord } from "./logic";

const HOUR = 3600 * 10_000_000;

const record = (id: string, item: Partial<BaseItem>, extra: Partial<DownloadRecord> = {}): DownloadRecord => ({
  id,
  item: { Id: id, Name: id, Type: "Episode", RunTimeTicks: HOUR, ...item },
  quality: "high",
  state: "done",
  bytes: 10,
  total: 10,
  addedAt: 0,
  mediaSourceId: "s",
  subtitleIndex: -1,
  files: { video: `${id}.mp4`, mime: "video/mp4", subtitles: [] },
  segments: [],
  position: 0,
  played: false,
  ...extra,
});

describe("sizes", () => {
  it("estimates a converted copy from bitrate and running time", () => {
    expect(estimateBytes({ RunTimeTicks: HOUR }, 8_000_000)).toBe(3_600_000_000);
    expect(formatBytes(3_600_000_000)).toBe("3.6 GB");
    expect(formatBytes(250_000_000)).toBe("250 MB");
  });
  it("holds an estimated download below 100% until it's done", () => {
    expect(percentOf({ bytes: 120, total: 100, state: "downloading" })).toBe(99);
    expect(percentOf({ bytes: 50, total: 100, state: "downloading" })).toBe(50);
    expect(percentOf({ bytes: 0, total: 0, state: "done" })).toBe(100);
  });
  it("names the saved file by its container", () => {
    expect(videoFileType("mkv")).toEqual({ ext: "mkv", mime: "video/x-matroska" });
    expect(videoFileType("mp4,m4v")).toEqual({ ext: "mp4", mime: "video/mp4" });
    expect(videoFileType("avi")).toEqual({ ext: "mp4", mime: "video/mp4" });
  });
});

describe("what a download keeps", () => {
  it("keeps the chosen audio, the subtitle files and the cast, and drops server-only parts", () => {
    const source: MediaSource = {
      Id: "s",
      Container: "mkv",
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      SupportsTranscoding: true,
      MediaStreams: [
        { Index: 0, Type: "Video" },
        { Index: 1, Type: "Audio", Language: "jpn" },
        { Index: 2, Type: "Audio", Language: "eng" },
        { Index: 3, Type: "Subtitle", Codec: "ass" },
      ],
    };
    const item = offlineItem(
      { Id: "e", Name: "E", Type: "Episode", Trickplay: {}, People: [{ Name: "A", Id: "a", Type: "Actor" }, { Name: "P", Id: "p", Type: "Producer" }] },
      source,
      2,
      [{ index: 3, label: "English", file: "e.3.vtt" }],
    );
    const streams = item.MediaSources![0].MediaStreams;
    expect(streams.map((s) => s.Index)).toEqual([0, 2, 3]);
    expect(streams[2]).toMatchObject({ Type: "Subtitle", Codec: "vtt", DeliveryMethod: "External", IsTextSubtitleStream: true });
    expect(item.People?.map((p) => p.Name)).toEqual(["A"]);
    expect(item.Trickplay).toBeUndefined();
  });
});

describe("offline watching", () => {
  const rs = [
    record("e3", { SeriesId: "S", SeriesName: "Show", ParentIndexNumber: 1, IndexNumber: 3 }),
    record("e1", { SeriesId: "S", SeriesName: "Show", ParentIndexNumber: 1, IndexNumber: 1 }),
    record("e2", { SeriesId: "S", SeriesName: "Show", ParentIndexNumber: 1, IndexNumber: 2 }, { state: "downloading" }),
    record("m", { Type: "Movie" }),
  ];
  it("groups films and shows, episodes in order", () => {
    const g = groupDownloads(rs);
    expect(g.movies.map((r) => r.id)).toEqual(["m"]);
    expect(g.shows[0].episodes.map((r) => r.id)).toEqual(["e1", "e2", "e3"]);
  });
  it("plays on through the downloaded episodes that are ready", () => {
    const n = offlineNeighbours(rs, "e1");
    expect(n.prev).toBeNull();
    expect(n.next?.Id).toBe("e3");
  });
  it("starts where you were, unless you'd finished", () => {
    expect(offlineStart({ item: { Id: "x", Name: "x", Type: "Movie", RunTimeTicks: HOUR }, position: HOUR / 2 })).toBe(HOUR / 2);
    expect(offlineStart({ item: { Id: "x", Name: "x", Type: "Movie", RunTimeTicks: HOUR }, position: HOUR * 0.97 })).toBe(0);
  });
  it("counts the credits as finished", () => {
    const r = record("x", {}, { segments: [{ Id: "o", ItemId: "x", Type: "Outro", StartTicks: HOUR * 0.8, EndTicks: HOUR }] });
    expect(watchedAt(r, HOUR * 0.85)).toBe(true);
    expect(watchedAt(r, HOUR * 0.5)).toBe(false);
  });
});
