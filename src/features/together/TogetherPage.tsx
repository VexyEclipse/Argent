import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/api/jellyfin";
import { landscapeImage } from "@/api/images";
import { episodeCode, formatClock } from "@/api/format";
import { getControllableSessions, getSessionById, remoteCommand, remotePlaystate, syncPlay, type SessionInfo } from "@/api/sessions";
import { useAuth } from "@/auth/AuthProvider";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/States";
import { showToast } from "@/components/Toast";
import { createGroup, getTogether, joinGroup, leaveGroup, setPlayTarget, useTogether } from "./store";
import "./together.css";

const TICKS = 10_000_000;

const deviceLabel = (s: Pick<SessionInfo, "DeviceName" | "Client">) => [s.DeviceName, s.Client].filter(Boolean).join(" · ");

async function attempt(action: () => Promise<unknown>, failure: string) {
  try {
    await action();
  } catch {
    showToast(failure);
  }
}

/**
 * Other devices and watching together: send what you play to a TV or another app
 * ("Play on"), control it like a remote, or start or join a Watch Together group whose
 * members play, pause and seek in sync.
 */
export default function TogetherPage() {
  return (
    <div className="page together">
      <header className="page-header">
        <h1 className="page-title">Devices & Watch Together</h1>
      </header>
      <div className="together__grid">
        <PlayOn />
        <WatchTogether />
      </div>
    </div>
  );
}

// ---- Play on ----------------------------------------------------------------------------

function PlayOn() {
  const { target } = useTogether();
  const sessions = useQuery({ queryKey: ["sessions", "controllable"], queryFn: getControllableSessions, refetchInterval: 10_000 });
  const ownDevice = client().deviceId;
  const devices = (sessions.data ?? []).filter((s) => s.DeviceId !== ownDevice && s.SupportsRemoteControl);

  return (
    <section className="panel together__section">
      <h2 className="together__title">
        <Icon name="cast" size={20} /> Play on
      </h2>
      <p className="together__desc">Choose where Play sends things. Pick another device and Argent becomes its remote until you switch back.</p>
      <div className="together__devices" role="radiogroup" aria-label="Play on">
        <button role="radio" aria-checked={!target} className={`together__device ${!target ? "is-active" : ""}`} onClick={() => setPlayTarget(null)}>
          <Icon name="check" size={18} className="together__tick" />
          <span className="together__device-name">This device</span>
        </button>
        {devices.map((s) => (
          <button
            key={s.Id}
            role="radio"
            aria-checked={target?.DeviceId === s.DeviceId}
            className={`together__device ${target?.DeviceId === s.DeviceId ? "is-active" : ""}`}
            onClick={() => setPlayTarget({ Id: s.Id, DeviceId: s.DeviceId, DeviceName: s.DeviceName, Client: s.Client })}
          >
            <Icon name="check" size={18} className="together__tick" />
            <span className="together__device-name">{deviceLabel(s)}</span>
            <span className="together__device-meta">{s.NowPlayingItem ? `Playing ${s.NowPlayingItem.SeriesName ?? s.NowPlayingItem.Name}` : s.UserName}</span>
          </button>
        ))}
        {sessions.isSuccess && devices.length === 0 && (
          <p className="together__desc">No other devices are open right now. Open Argent or another Jellyfin app on your TV and it appears here.</p>
        )}
      </div>
      {target && <RemoteControl deviceId={target.DeviceId!} />}
    </section>
  );
}

function RemoteControl({ deviceId }: { deviceId: string }) {
  const session = useQuery({ queryKey: ["sessions", "device", deviceId], queryFn: () => getSessionById(deviceId), refetchInterval: 1500 });
  const s = session.data;
  // The server gives a reconnected app a new session id; follow it.
  useEffect(() => {
    if (s && s.Id !== getTogether().target?.Id) setPlayTarget({ Id: s.Id, DeviceId: s.DeviceId, DeviceName: s.DeviceName, Client: s.Client });
  }, [s]);
  const [scrub, setScrub] = useState<number | null>(null);
  const qc = useQueryClient();
  if (session.isPending) return null;
  if (!s) return <p className="together__desc">That device has gone offline.</p>;
  const item = s.NowPlayingItem;
  const ps = s.PlayState ?? {};
  const duration = (item?.RunTimeTicks ?? 0) / TICKS;
  const position = scrub ?? (ps.PositionTicks ?? 0) / TICKS;
  const send = (fn: () => Promise<unknown>) => attempt(fn, "That device didn't respond").then(() => qc.invalidateQueries({ queryKey: ["sessions", "device", deviceId] }));
  const audio = item?.MediaStreams?.filter((m) => m.Type === "Audio") ?? [];
  const subs = item?.MediaStreams?.filter((m) => m.Type === "Subtitle") ?? [];

  return (
    <div className="remote" aria-label={`Remote for ${s.DeviceName}`}>
      {item ? (
        <>
          <div className="remote__now">
            <div className="remote__art">
              <Artwork image={landscapeImage(item, 480)} alt="" />
            </div>
            <div>
              <div className="eyebrow">Now playing on {s.DeviceName}</div>
              <div className="remote__title">{item.SeriesName ?? item.Name}</div>
              {item.Type === "Episode" && (
                <div className="remote__sub">
                  {episodeCode(item)} · {item.Name}
                </div>
              )}
            </div>
          </div>
          {duration > 0 && (
            <div className="remote__seek">
              <span>{formatClock(position)}</span>
              <input
                type="range"
                className="remote__range"
                min={0}
                max={duration}
                step={1}
                value={position}
                aria-label="Position"
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={() => {
                  if (scrub !== null) send(() => remotePlaystate(s.Id, "Seek", Math.round(scrub * TICKS))).finally(() => setScrub(null));
                }}
                onKeyUp={(e) => {
                  if (scrub !== null && (e.key === "ArrowLeft" || e.key === "ArrowRight")) send(() => remotePlaystate(s.Id, "Seek", Math.round(scrub * TICKS))).finally(() => setScrub(null));
                }}
              />
              <span>{formatClock(duration)}</span>
            </div>
          )}
          <div className="remote__buttons">
            <Button variant="icon" size="lg" icon="skipPrev" aria-label="Previous" onClick={() => send(() => remotePlaystate(s.Id, "PreviousTrack"))} />
            <Button variant="icon" size="lg" icon="replay10" aria-label="Back 10 seconds" onClick={() => send(() => remotePlaystate(s.Id, "Seek", Math.max(0, (ps.PositionTicks ?? 0) - 10 * TICKS)))} />
            <Button variant="primary" size="lg" icon={ps.IsPaused ? "play" : "pause"} aria-label={ps.IsPaused ? "Play" : "Pause"} onClick={() => send(() => remotePlaystate(s.Id, "PlayPause"))} />
            <Button variant="icon" size="lg" icon="forward10" aria-label="Forward 10 seconds" onClick={() => send(() => remotePlaystate(s.Id, "Seek", (ps.PositionTicks ?? 0) + 10 * TICKS))} />
            <Button variant="icon" size="lg" icon="skipNext" aria-label="Next" onClick={() => send(() => remotePlaystate(s.Id, "NextTrack"))} />
            <Button variant="icon" size="lg" icon="stop" aria-label="Stop" onClick={() => send(() => remotePlaystate(s.Id, "Stop"))} />
          </div>
          <div className="remote__row">
            <Button variant="icon" size="md" icon={ps.IsMuted ? "volumeOff" : "volume"} aria-label={ps.IsMuted ? "Unmute" : "Mute"} onClick={() => send(() => remoteCommand(s.Id, "ToggleMute"))} />
            <input
              type="range"
              className="remote__range"
              min={0}
              max={100}
              step={5}
              defaultValue={ps.VolumeLevel ?? 100}
              aria-label="Volume"
              onChange={(e) => send(() => remoteCommand(s.Id, "SetVolume", { Volume: e.target.value }))}
            />
          </div>
          {(audio.length > 1 || subs.length > 0) && (
            <div className="remote__row remote__tracks">
              {audio.length > 1 && (
                <select
                  className="select select--compact"
                  aria-label="Audio"
                  value={ps.AudioStreamIndex ?? ""}
                  onChange={(e) => send(() => remoteCommand(s.Id, "SetAudioStreamIndex", { Index: e.target.value }))}
                >
                  {audio.map((a) => (
                    <option key={a.Index} value={a.Index}>
                      {a.DisplayTitle ?? a.Language ?? `Audio ${a.Index}`}
                    </option>
                  ))}
                </select>
              )}
              {subs.length > 0 && (
                <select
                  className="select select--compact"
                  aria-label="Subtitles"
                  value={ps.SubtitleStreamIndex ?? -1}
                  onChange={(e) => send(() => remoteCommand(s.Id, "SetSubtitleStreamIndex", { Index: e.target.value }))}
                >
                  <option value={-1}>Subtitles off</option>
                  {subs.map((a) => (
                    <option key={a.Index} value={a.Index}>
                      {a.DisplayTitle ?? a.Language ?? `Subtitle ${a.Index}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="together__desc">
          Nothing is playing on {s.DeviceName}. Pick something in Argent and press Play: it starts there. <Link to="/">Browse</Link>
        </p>
      )}
    </div>
  );
}

// ---- Watch Together -------------------------------------------------------------------

function WatchTogether() {
  const { user } = useAuth();
  const { group } = useTogether();
  const groups = useQuery({ queryKey: ["syncplay", "groups"], queryFn: syncPlay.list, refetchInterval: group ? false : 8000, retry: false });
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    attempt(fn, failure).finally(() => setBusy(false));
  };

  return (
    <section className="panel together__section">
      <h2 className="together__title">
        <Icon name="users" size={20} /> Watch Together
      </h2>
      <p className="together__desc">
        Everyone in a group sees the same thing at the same moment, on their own screen. Anyone can pause or skip; it happens for all. Uses Jellyfin's SyncPlay, so people
        in jellyfin-web or other Jellyfin apps can join too.
      </p>
      {groups.isError ? (
        <EmptyState title="Watch Together is off" body="SyncPlay isn't available to your account. An administrator can allow it in the user's settings on the server dashboard." />
      ) : group ? (
        <div className="together__group">
          <div className="together__group-head">
            <div>
              <div className="eyebrow">You're in</div>
              <div className="remote__title">{group.GroupName}</div>
              <div className="remote__sub">
                {group.State === "Playing" ? "Playing" : group.State === "Paused" ? "Paused" : group.State === "Waiting" ? "Waiting for everyone" : "Pick something to watch"}
              </div>
            </div>
            <Button variant="secondary" size="sm" icon="logout" disabled={busy} onClick={() => run(leaveGroup, "Couldn't leave the group")}>
              Leave
            </Button>
          </div>
          <ul className="together__people">
            {group.Participants.map((p) => (
              <li key={p}>
                <Icon name="user" size={16} /> {p}
              </li>
            ))}
          </ul>
          <p className="together__desc">Press Play on anything and it starts for the whole group.</p>
        </div>
      ) : (
        <>
          <Button variant="primary" icon="plus" disabled={busy} onClick={() => run(() => createGroup(`${user?.Name ?? "My"}'s group`), "Couldn't start a group")}>
            Start a group
          </Button>
          {(groups.data ?? []).length > 0 && <div className="menu__label">Join a group</div>}
          <div className="together__devices">
            {(groups.data ?? []).map((g) => (
              <button key={g.GroupId} className="together__device" disabled={busy} onClick={() => run(() => joinGroup(g.GroupId), "Couldn't join that group")}>
                <Icon name="users" size={18} />
                <span className="together__device-name">{g.GroupName}</span>
                <span className="together__device-meta">
                  {g.Participants.length} {g.Participants.length === 1 ? "person" : "people"} · {g.State}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
