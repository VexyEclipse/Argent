import { useEffect, useRef, type ReactNode } from "react";
import { logoImage } from "@/api/images";
import { episodeCode, formatClock } from "@/api/format";
import type { BaseItem, MediaStream } from "@/api/types";
import { Icon } from "@/components/Icon";
import { FillerBadge } from "@/features/filler/FillerBadge";
import { useFillerIds } from "@/features/filler/store";
import type { Platform } from "@/platform/platform";
import { QUALITY_OPTIONS } from "./deviceProfile";
import type { StreamInfo } from "./playback";
import { streamsOfType, subtitleIsText } from "./playback";
import type { SoundPrefs } from "./audioEffects";
import { PlayerMenu } from "./PlayerMenu";
import { Seekbar } from "./Seekbar";
import { versionLabel, versionOption } from "./streamPlan";

export type Menu = "audio" | "subtitles" | "quality" | "speed" | "version" | "sound" | "info" | null;

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const METHOD_LABELS = { DirectPlay: "Direct Play", DirectStream: "Direct Stream", Transcode: "Transcoding" } as const;

const trackLabel = (s: MediaStream) => s.DisplayTitle || s.Language || `Track ${s.Index}`;

/** The top bar: back, title, playback info. */
export function TopBar(props: { item: BaseItem | undefined; menu: Menu; setMenu: (m: Menu) => void; onBack: () => void; badge?: ReactNode; onMouseUp: (e: React.MouseEvent) => void }) {
  const { item, menu, setMenu } = props;
  const logo = item ? logoImage(item, 500) : null;
  const filler = useFillerIds(item?.Type === "Episode" ? item.SeriesId : undefined);
  return (
    <div className="pc pc--top" onMouseUp={props.onMouseUp}>
      <button className="pc__btn" onClick={props.onBack} aria-label="Back">
        <Icon name="chevronLeft" size={26} />
      </button>
      <div className="pc__title">
        {item?.Type === "Episode" ? (
          <>
            <span className="pc__series">{item.SeriesName}</span>
            <span className="pc__episode">
              {episodeCode(item)}
              {filler.has(item.Id) ? <FillerBadge /> : " · "}
              {item.Name}
            </span>
          </>
        ) : logo ? (
          <img className="pc__logo" src={logo.url} alt={item?.Name} />
        ) : (
          <span className="pc__series">{item?.Name}</span>
        )}
      </div>
      {props.badge}
      <button className={`pc__btn pc__menu-trigger ${menu === "info" ? "is-active" : ""}`} onClick={() => setMenu(menu === "info" ? null : "info")} aria-label="Playback info">
        <Icon name="info" size={22} />
      </button>
    </div>
  );
}

export interface BottomBarProps {
  item: BaseItem | undefined;
  stream: StreamInfo | null;
  platform: Platform;
  menu: Menu;
  setMenu: (m: Menu) => void;
  current: number;
  duration: number;
  buffered: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  quality: number;
  fullscreen: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  subOffset: number;
  setSubOffset: (fn: (o: number) => number) => void;
  subtitlesAdjustable: boolean;
  onMouseUp: (e: React.MouseEvent) => void;
  onSeek: (seconds: number) => void;
  onScrub: (scrubbing: boolean) => void;
  onSeekBy: (seconds: number) => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
  onSubtitle: (index: number) => void;
  onAudio: (index: number) => void;
  onSpeed: (rate: number) => void;
  onQuality: (bitrate: number) => void;
  onVersion: (sourceId: string) => void;
  onPip?: () => void;
  onFullscreen: () => void;
  sound: SoundPrefs;
  /** False where the browser plays the stream itself and Web Audio can't reach its sound. */
  soundSupported: boolean;
  onSound: (patch: Partial<SoundPrefs>) => void;
}

/** Seekbar, transport and the track, speed, quality and version menus. */
export function BottomBar(p: BottomBarProps) {
  const { stream, menu, setMenu } = p;
  const audioStreams = streamsOfType(stream?.source, "Audio");
  const subtitleStreams = streamsOfType(stream?.source, "Subtitle");
  const versions = stream?.versions ?? [];
  const trigger = (m: Exclude<Menu, null>, icon: Parameters<typeof Icon>[0]["name"], label: string, title: string) => (
    <button className={`pc__btn pc__menu-trigger ${menu === m ? "is-active" : ""}`} onClick={() => setMenu(menu === m ? null : m)} aria-label={label} title={title}>
      <Icon name={icon} size={22} />
    </button>
  );

  return (
    <div className="pc pc--bottom" onMouseUp={p.onMouseUp}>
      {p.item && <Seekbar item={p.item} mediaSourceId={stream?.source.Id} current={p.current} duration={p.duration} buffered={p.buffered} onSeek={p.onSeek} onScrub={p.onScrub} />}
      <div className="pc__row">
        <div className="pc__group">
          {p.hasPrev && (
            <button className="pc__btn" onClick={p.onPrev} aria-label="Previous episode" title="Previous episode (Shift+P)">
              <Icon name="skipPrev" size={22} />
            </button>
          )}
          <button className="pc__btn" onClick={() => p.onSeekBy(-10)} aria-label="Back 10 seconds" title="Back 10s (←)">
            <Icon name="replay10" size={26} />
          </button>
          <button className="pc__btn pc__play" onClick={p.onTogglePlay} aria-label={p.playing ? "Pause" : "Play"} title={p.playing ? "Pause (Space)" : "Play (Space)"}>
            <Icon name={p.playing ? "pause" : "play"} size={30} />
          </button>
          <button className="pc__btn" onClick={() => p.onSeekBy(10)} aria-label="Forward 10 seconds" title="Forward 10s (→)">
            <Icon name="forward10" size={26} />
          </button>
          {p.hasNext && (
            <button className="pc__btn" onClick={p.onNext} aria-label="Next episode" title="Next episode (Shift+N)">
              <Icon name="skipNext" size={22} />
            </button>
          )}
          <div className="pc__volume">
            <button className="pc__btn" onClick={p.onToggleMute} aria-label={p.muted ? "Unmute" : "Mute"} title="Mute (M)">
              <Icon name={p.muted || p.volume === 0 ? "volumeOff" : "volume"} size={22} />
            </button>
            <input
              className="pc__volume-range"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={p.muted ? 0 : p.volume}
              onChange={(e) => p.onVolume(Number(e.target.value))}
              aria-label="Volume"
              style={{ ["--fill" as string]: `${(p.muted ? 0 : p.volume) * 100}%` }}
            />
          </div>
          <span className="pc__time">
            {formatClock(p.current)} <span className="pc__time-sep">/</span> {formatClock(p.duration)}
          </span>
        </div>

        <div className="pc__group pc__group--end">
          {subtitleStreams.length > 0 && trigger("subtitles", "subtitles", "Subtitles", "Subtitles (C)")}
          {audioStreams.length > 1 && trigger("audio", "audio", "Audio track", "Audio")}
          {versions.length > 1 && trigger("version", "layers", "Version", "Version")}
          {trigger("sound", "sound", "Sound: dialogue boost and volume levelling", "Sound")}
          {trigger("speed", "speed", "Playback speed", "Speed")}
          {!stream?.offline && trigger("quality", "sliders", "Quality", "Quality")}
          {p.onPip && (
            <button className="pc__btn" onClick={p.onPip} aria-label="Picture in picture" title="Picture in picture">
              <Icon name="pip" size={22} />
            </button>
          )}
          {p.platform !== "tv" && (
            <button className="pc__btn" onClick={p.onFullscreen} aria-label={p.fullscreen ? "Exit full screen" : "Full screen"} title="Full screen (F)">
              <Icon name={p.fullscreen ? "fullscreenExit" : "fullscreen"} size={22} />
            </button>
          )}
        </div>
      </div>

      {menu === "subtitles" && stream && (
        <PlayerMenu
          title="Subtitles"
          value={stream.subtitleIndex ?? -1}
          onChange={p.onSubtitle}
          onClose={() => setMenu(null)}
          options={[
            { value: -1, label: "Off" },
            ...subtitleStreams.map((s) => ({
              value: s.Index,
              label: trackLabel(s),
              detail: [s.IsForced && "Forced", s.IsExternal && "External", !subtitleIsText(s) && "Burned in"].filter(Boolean).join(" · ") || undefined,
            })),
          ]}
          footer={
            p.subtitlesAdjustable ? (
              <div className="pmenu__offset">
                <span>Sync</span>
                <button className="pc__btn pc__btn--sm" onClick={() => p.setSubOffset((o) => Math.round((o - 0.1) * 10) / 10)} aria-label="Subtitles earlier">
                  −
                </button>
                <span className="pmenu__offset-value">
                  {p.subOffset > 0 ? "+" : ""}
                  {p.subOffset.toFixed(1)}s
                </span>
                <button className="pc__btn pc__btn--sm" onClick={() => p.setSubOffset((o) => Math.round((o + 0.1) * 10) / 10)} aria-label="Subtitles later">
                  +
                </button>
                {p.subOffset !== 0 && (
                  <button className="pmenu__reset" onClick={() => p.setSubOffset(() => 0)}>
                    Reset
                  </button>
                )}
              </div>
            ) : stream.subtitleIndex !== undefined && stream.subtitleIndex >= 0 ? (
              <span className="pmenu__hint">Burned-in subtitles can't be re-timed.</span>
            ) : null
          }
        />
      )}
      {menu === "audio" && stream && (
        <PlayerMenu
          title="Audio"
          value={stream.audioIndex ?? -1}
          onChange={p.onAudio}
          onClose={() => setMenu(null)}
          options={audioStreams.map((s) => ({ value: s.Index, label: trackLabel(s), detail: s.IsDefault ? "Default" : undefined }))}
        />
      )}
      {menu === "version" && stream && (
        <PlayerMenu
          title="Version"
          value={stream.source.Id}
          onChange={p.onVersion}
          onClose={() => setMenu(null)}
          options={versions.map((v, i) => {
            const { label, detail } = versionOption(v, i);
            return { value: v.Id, label, detail: detail || undefined };
          })}
        />
      )}
      {menu === "sound" && <SoundMenu sound={p.sound} supported={p.soundSupported} onChange={p.onSound} onClose={() => setMenu(null)} />}
      {menu === "speed" && (
        <PlayerMenu
          title="Speed"
          value={p.rate}
          onChange={p.onSpeed}
          onClose={() => setMenu(null)}
          options={SPEEDS.map((s) => ({ value: s, label: s === 1 ? "Normal" : `${s}×` }))}
        />
      )}
      {menu === "quality" && (
        <PlayerMenu
          title="Quality"
          value={p.quality}
          onChange={p.onQuality}
          onClose={() => setMenu(null)}
          options={QUALITY_OPTIONS.map((q) => ({
            value: q.bitrate,
            label: q.label,
            detail: q.bitrate === QUALITY_OPTIONS[0].bitrate ? "Direct play when possible" : undefined,
          }))}
        />
      )}
    </div>
  );
}

/** Switches for the sound effects, in the player's menu style. */
function SoundMenu({ sound, supported, onChange, onClose }: { sound: SoundPrefs; supported: boolean; onChange: (patch: Partial<SoundPrefs>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".pc__menu-trigger")) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);
  const rows: [keyof SoundPrefs, string, string][] = [
    ["dialogue", "Dialogue boost", "Clearer voices over music and effects"],
    ["level", "Volume levelling", "Evens out loud and quiet scenes"],
  ];
  return (
    <div className="pmenu" ref={ref} role="dialog" aria-label="Sound">
      <div className="pmenu__title">Sound</div>
      <div className="pmenu__list">
        {rows.map(([key, label, detail]) => (
          <button
            key={key}
            role="switch"
            aria-checked={sound[key]}
            className={`pmenu__item ${sound[key] ? "is-active" : ""}`}
            onClick={() => onChange({ [key]: !sound[key] })}
            disabled={!supported}
          >
            <span className="pmenu__check">{sound[key] && <Icon name="check" size={16} />}</span>
            <span className="pmenu__label">
              {label}
              <span className="pmenu__detail">{detail}</span>
            </span>
          </button>
        ))}
      </div>
      {!supported && (
        <div className="pmenu__footer">
          <span className="pmenu__hint">Not available for this stream on this device.</span>
        </div>
      )}
    </div>
  );
}

/** What's playing and how: the method, why the server converts, the tracks and bitrate. */
export function PlaybackInfo({ stream, onCopyDiagnostics }: { stream: StreamInfo; onCopyDiagnostics: () => void }) {
  const video = streamsOfType(stream.source, "Video")[0];
  const audio = streamsOfType(stream.source, "Audio").find((a) => a.Index === stream.audioIndex);
  const rows: [string, ReactNode][] = [
    ["Method", stream.offline ? "Downloaded" : METHOD_LABELS[stream.method]],
    ...(stream.transcodeReasons.length ? [["Reason", stream.transcodeReasons.map((r) => r.replace(/([a-z])([A-Z])/g, "$1 $2")).join(", ")] as [string, ReactNode]] : []),
    ...(stream.versions.length > 1 ? [["Version", versionLabel(stream.source, stream.versions.indexOf(stream.source))] as [string, ReactNode]] : []),
    ["Container", stream.source.Container?.toUpperCase()],
    ...(video ? [["Video", video.DisplayTitle] as [string, ReactNode]] : []),
    ...(audio ? [["Audio", audio.DisplayTitle] as [string, ReactNode]] : []),
    ...(stream.source.Bitrate ? [["Bitrate", `${(stream.source.Bitrate / 1_000_000).toFixed(1)} Mbps`] as [string, ReactNode]] : []),
  ];
  return (
    <div className="pinfo fade-in" role="dialog" aria-label="Playback info">
      <div className="pmenu__title">Playback</div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button className="pmenu__reset pinfo__copy" onClick={onCopyDiagnostics}>
        <Icon name="copy" size={14} /> Copy diagnostics
      </button>
    </div>
  );
}
