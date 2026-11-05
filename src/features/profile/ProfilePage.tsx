import { useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { APP_VERSION } from "@/api/client";
import { LANGUAGES as LANGUAGE_LIST } from "@/api/languages";
import { client, getPublicInfo, updateUserConfiguration } from "@/api/jellyfin";
import type { UserConfiguration } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { JellyfinMark } from "@/components/JellyfinLogo";
import { clearDismissed, readFeedback, subscribeFeedback } from "@/features/recommendations/feedback";
import { announcesFollowed, refreshUpcoming, setUpcomingPref, useUpcomingEntries, useUpcomingPrefs } from "@/features/upcoming/store";
import { desktop, useDesktopInfo, type DesktopInfo, type UpdateStatus } from "@/platform/desktop";
import { getPlatformOverride, setPlatformOverride, type Platform } from "@/platform/platform";
import { setRatingPref, useRatingPrefs } from "@/features/ratings/prefs";
import { androidApp } from "@/platform/android";
import { setFillerPref, useFillerPrefs } from "@/features/filler/store";
import { readAutoSkip, readPauseInfo, saveAutoSkip, savePauseInfo } from "@/features/player/prefs";
import { AndroidSection, HelpSection } from "./DeviceSections";
import { MediaProfile } from "./MediaProfile";
import { Toggle } from "./Toggle";
import "./profile.css";

const LANGUAGES: [string, string][] = [["", "Any / server default"], ...LANGUAGE_LIST];

function updateLabel(status: UpdateStatus): string {
  switch (status.state) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return "You're on the latest version";
    case "downloading":
      return `Downloading ${status.version ?? "update"}… ${status.percent}%`;
    case "ready":
      return `Version ${status.version} is ready to install`;
    case "error":
      return `Couldn't check for updates: ${status.message}`;
    case "unsupported":
      return "Updates are available in the installed app";
    default:
      return "Updates download in the background";
  }
}

/** The daily TVmaze check behind the Coming Up row. */
function ComingUpSection({ userId }: { userId: string }) {
  const prefs = useUpcomingPrefs();
  const { entries, checkedAt, checking } = useUpcomingEntries();
  const last = checkedAt
    ? `Last checked ${new Date(checkedAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${entries.length} upcoming`
    : "Not checked yet";
  return (
    <section className="panel profile__section">
      <h2 className="profile__title">Coming Up</h2>
      <p className="profile__desc">
        Once a day Argent asks TVmaze about the shows you follow (started, favourited or on your watchlist). Only each show's TVDB or IMDb id is sent, so
        TVmaze can see which shows are looked up, but never your server address, your account or your watch history. This device only.
      </p>
      <Toggle
        label="Check for new episodes and seasons"
        hint="Adds announced seasons and episodes Jellyfin doesn't know about yet"
        checked={prefs.tvmaze}
        onChange={(v) => setUpcomingPref("tvmaze", v)}
      />
      {prefs.tvmaze && (
        <div className="setting">
          <div className="setting__text">
            <span className="setting__label">Schedule</span>
            <span className="setting__hint">{checking ? "Checking your shows…" : last}</span>
          </div>
          <Button variant="secondary" size="sm" disabled={checking} onClick={() => refreshUpcoming(userId, true)}>
            Check now
          </Button>
        </div>
      )}
      {announcesFollowed() && prefs.tvmaze && (
        <Toggle
          label="Notify me"
          hint="When an episode of your show airs today, or a new season is announced. Shows you set a reminder for always notify."
          checked={prefs.notify}
          onChange={(v) => setUpcomingPref("notify", v)}
        />
      )}
    </section>
  );
}

/** Skipping intros, credits and anime filler. */
function SkippingSection() {
  const [skip, setSkip] = useState(readAutoSkip);
  const filler = useFillerPrefs();
  const change = (patch: Partial<typeof skip>) => {
    const next = { ...skip, ...patch };
    setSkip(next);
    saveAutoSkip(next);
  };
  return (
    <section className="panel profile__section">
      <h2 className="profile__title">Skipping</h2>
      <p className="profile__desc">
        This device only. Without these, a Skip card comes up as each intro or the credits start: press it, or S on a keyboard.
      </p>
      <Toggle label="Skip intros" hint="Jumps past an intro as it starts. A toast lets you go back and watch it." checked={skip.intro} onChange={(v) => change({ intro: v })} />
      <Toggle
        label="Skip credits"
        hint="Goes straight to the next episode when the credits start. A film's credits always play, in case of a final scene."
        checked={skip.credits}
        onChange={(v) => change({ credits: v })}
      />
      <Toggle
        label="Mark filler episodes"
        hint="A Filler badge on anime episodes outside the source story. Each show is looked up on MyAnimeList (through Jikan) by its ids or title; nothing about you is sent."
        checked={filler.badges}
        onChange={(v) => setFillerPref("badges", v)}
      />
      <Toggle
        label="Skip all filler"
        hint="Next episode, autoplay and a show's Play button pass over filler. You can still pick a filler episode yourself."
        checked={filler.skip}
        onChange={(v) => setFillerPref("skip", v)}
      />
    </section>
  );
}

/** Settings that only exist in the Argent desktop app. */
function DesktopSection({ info, setSetting, refresh }: { info: DesktopInfo; setSetting: ReturnType<typeof useDesktopInfo>["setSetting"]; refresh: () => void }) {
  const { settings, update } = info;
  const busy = update.state === "checking" || update.state === "downloading";
  return (
    <section className="panel profile__section">
      <h2 className="profile__title">Desktop app</h2>
      <p className="profile__desc">This computer only.</p>
      <div className="setting">
        <div className="setting__text">
          <span className="setting__label">Argent {info.version}</span>
          <span className="setting__hint">{updateLabel(update)}</span>
        </div>
        {update.state === "ready" ? (
          <Button variant="primary" size="sm" onClick={() => desktop?.installUpdate()}>
            Restart to update
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={busy || update.state === "unsupported"} onClick={() => desktop?.checkForUpdates()}>
            Check now
          </Button>
        )}
      </div>
      <Toggle
        label="Update automatically"
        hint="Downloads in the background and installs when you quit"
        checked={settings.autoUpdate}
        onChange={(v) => setSetting("autoUpdate", v)}
      />
      <Toggle
        label="Keep running in the tray when closed"
        hint="Closing the window pauses playback; quit from the tray icon"
        checked={settings.closeToTray}
        onChange={(v) => setSetting("closeToTray", v)}
      />
      {/* Desktop apps before 0.7 have no mpv support. */}
      {settings.useMpv !== undefined && (
        <>
          <Toggle
            label="Play in mpv"
            hint={
              info.mpv
                ? "Plays every format directly, with HDR, surround passthrough and every subtitle type. Argent still saves your progress and plays the next episode."
                : "Install mpv (mpv.io) to play every format directly, then choose it here."
            }
            checked={settings.useMpv}
            onChange={(v) => setSetting("useMpv", v)}
          />
          {settings.useMpv && (
            <div className="setting">
              <div className="setting__text">
                <span className="setting__label">mpv</span>
                <span className="setting__hint">{info.mpv ?? "Not found. Choose mpv.exe."}</span>
              </div>
              {desktop?.chooseMpv && (
                <Button variant="secondary" size="sm" onClick={() => desktop?.chooseMpv?.().then(refresh)}>
                  Choose…
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const { user, account, isAdmin, refreshUser, signOut, addAccount } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [platform, setPlatform] = useState<Platform | "auto">(getPlatformOverride);
  const [pauseInfo, setPauseInfo] = useState(readPauseInfo);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "settings" ? "settings" : "media";
  const ratingPrefs = useRatingPrefs();
  const desktopApp = useDesktopInfo();
  const server = useQuery({ queryKey: ["server-info"], queryFn: () => getPublicInfo(client()), staleTime: 10 * 60_000 });
  const dismissedCount = useSyncExternalStore(subscribeFeedback, () => Object.keys(readFeedback(user?.Id ?? "").dismissed).length);
  const cfg = user?.Configuration ?? {};

  const save = async (patch: Partial<UserConfiguration>) => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateUserConfiguration({ ...cfg, ...patch });
      await refreshUser();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <div className="page profile">
      <header className="profile__header">
        {user.PrimaryImageTag ? (
          <img className="avatar profile__avatar" src={client().userImageUrl(user.Id, user.PrimaryImageTag, 192)} alt="" />
        ) : (
          <span className="avatar profile__avatar">{user.Name.slice(0, 1).toUpperCase()}</span>
        )}
        <div>
          <h1 className="page-title">{user.Name}</h1>
          <p className="muted">
            {account?.serverName}
            {isAdmin ? " · Administrator" : ""}
          </p>
        </div>
        <span className="profile__status" aria-live="polite">
          {saving ? "Saving…" : saved ? "Saved" : ""}
        </span>
      </header>

      <div className="tabs profile__tabs" role="tablist" aria-label="Profile">
        {(
          [
            ["media", "Media profile"],
            ["settings", "Settings"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            className={tab === v ? "is-active" : ""}
            onClick={() => setParams(v === "media" ? {} : { tab: v }, { replace: true })}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "media" && <MediaProfile />}

      {tab === "settings" && (
        <div className="profile__grid">
          <section className="panel profile__section">
            <h2 className="profile__title">Playback</h2>
            <p className="profile__desc">Stored on your server account, so every app you use follows them.</p>
            <label className="field">
              <span className="field__label">Preferred audio language</span>
              <select className="select" value={cfg.AudioLanguagePreference ?? ""} onChange={(e) => save({ AudioLanguagePreference: e.target.value })}>
                {LANGUAGES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Preferred subtitle language</span>
              <select className="select" value={cfg.SubtitleLanguagePreference ?? ""} onChange={(e) => save({ SubtitleLanguagePreference: e.target.value })}>
                {LANGUAGES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Subtitles</span>
              <select
                className="select"
                value={cfg.SubtitleMode ?? "Default"}
                onChange={(e) => save({ SubtitleMode: e.target.value as UserConfiguration["SubtitleMode"] })}
              >
                <option value="Default">Default — follow the file</option>
                <option value="Smart">Smart — when audio isn't in my language</option>
                <option value="OnlyForced">Forced only</option>
                <option value="Always">Always</option>
                <option value="None">Never</option>
              </select>
            </label>
            <Toggle
              label="Play next episode automatically"
              checked={cfg.EnableNextEpisodeAutoPlay !== false}
              onChange={(v) => save({ EnableNextEpisodeAutoPlay: v })}
            />
            <Toggle
              label="Play default audio track"
              hint="Regardless of language preference"
              checked={cfg.PlayDefaultAudioTrack !== false}
              onChange={(v) => save({ PlayDefaultAudioTrack: v })}
            />
            <Toggle label="Remember audio selections" checked={Boolean(cfg.RememberAudioSelections)} onChange={(v) => save({ RememberAudioSelections: v })} />
            <Toggle
              label="Remember subtitle selections"
              checked={Boolean(cfg.RememberSubtitleSelections)}
              onChange={(v) => save({ RememberSubtitleSelections: v })}
            />
          </section>

          <section className="panel profile__section">
            <h2 className="profile__title">Display</h2>
            <p className="profile__desc">This device only.</p>
            <div className="field">
              <span className="field__label">Interface</span>
              <div className="tabs" role="radiogroup" aria-label="Interface">
                {(
                  [
                    ["auto", "Automatic"],
                    ["desktop", "Desktop"],
                    ["mobile", "Mobile"],
                    ["tv", "TV"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={platform === v}
                    className={platform === v ? "is-active" : ""}
                    onClick={() => {
                      setPlatform(v);
                      setPlatformOverride(v);
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Toggle
              label="Show details when paused"
              hint="After a few seconds paused, the picture dims and shows what's playing, the story and the cast"
              checked={pauseInfo}
              onChange={(v) => {
                setPauseInfo(v);
                savePauseInfo(v);
              }}
            />
            <Toggle
              label="Hide watched items in Recently Added"
              hint="Account setting"
              checked={Boolean(cfg.HidePlayedInLatest)}
              onChange={(v) => save({ HidePlayedInLatest: v })}
            />
          </section>

          <SkippingSection />

          <ComingUpSection userId={user.Id} />

          {desktopApp.info && <DesktopSection info={desktopApp.info} setSetting={desktopApp.setSetting} refresh={desktopApp.refresh} />}

          {androidApp && <AndroidSection />}

          <section className="panel profile__section">
            <h2 className="profile__title">Ratings</h2>
            <p className="profile__desc">This device only. Your ratings themselves sync with your account.</p>
            <Toggle
              label="Ask to rate each season"
              hint="After a season's last episode, not only when a series ends"
              checked={ratingPrefs.rateSeasons}
              onChange={(v) => setRatingPref("rateSeasons", v)}
            />
            <Toggle
              label="Show my scores on posters"
              hint="A small star badge on titles you've rated"
              checked={ratingPrefs.posterScores}
              onChange={(v) => setRatingPref("posterScores", v)}
            />
          </section>

          <section className="panel profile__section">
            <h2 className="profile__title">Recommendations</h2>
            <p className="profile__desc">Built only from your own viewing history and titles in your library. Other users on this server get their own.</p>
            <div className="setting">
              <div className="setting__text">
                <span className="setting__label">Hidden titles</span>
                <span className="setting__hint">{dismissedCount ? `${dismissedCount} marked “Not interested”` : "Nothing hidden"}</span>
              </div>
              <Button variant="secondary" size="sm" disabled={!dismissedCount} onClick={() => clearDismissed(user.Id)}>
                Restore
              </Button>
            </div>
          </section>

          <HelpSection />

          <section className="panel profile__section">
            <h2 className="profile__title">Account</h2>
            <div className="profile__actions">
              {isAdmin && (
                <a className="btn btn--secondary btn--md" href={`${client().serverUrl}/web/#/dashboard`} target="_blank" rel="noreferrer">
                  <Icon name="dashboard" size={18} /> Server dashboard
                </a>
              )}
              <a className="btn btn--secondary btn--md" href={`${client().serverUrl}/web/#/userprofile?userId=${user.Id}`} target="_blank" rel="noreferrer">
                <Icon name="user" size={18} /> Password & profile image
              </a>
              <a className="btn btn--secondary btn--md" href={`${client().serverUrl}/web/#/quickconnect`} target="_blank" rel="noreferrer">
                <Icon name="external" size={18} /> Quick Connect
              </a>
              <Button variant="secondary" icon="swap" onClick={addAccount}>
                Switch user
              </Button>
              <Button variant="secondary" icon="logout" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </section>
        </div>
      )}

      <footer className="profile__about">
        <JellyfinMark size={22} />
        <span>
          Argent {APP_VERSION} · {server.data?.ServerName ?? account?.serverName} · Server {server.data?.Version ?? ""}
        </span>
      </footer>
    </div>
  );
}
