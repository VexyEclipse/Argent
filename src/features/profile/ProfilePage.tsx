import { useMemo, useState, useSyncExternalStore } from "react";
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
import { setStillsPref, useStillsPref } from "@/features/manage/stills";
import { AndroidSection, HelpSection } from "./DeviceSections";
import { SettingsNav, SettingsSection, type SettingsNavItem } from "./SettingsLayout";
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
    <SettingsSection
      id="coming-up"
      icon="calendar"
      title="Coming Up"
      desc="This device only. Once a day Argent asks TVmaze about the shows you follow (started, favourited or on your watchlist). Only each show's TVDB or IMDb id is sent, never your server address, account or watch history."
    >
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
    </SettingsSection>
  );
}

/** Skipping intros, credits and anime filler. */
function SkippingSection() {
  const { isAdmin } = useAuth();
  const [skip, setSkip] = useState(readAutoSkip);
  const filler = useFillerPrefs();
  const change = (patch: Partial<typeof skip>) => {
    const next = { ...skip, ...patch };
    setSkip(next);
    saveAutoSkip(next);
  };
  return (
    <SettingsSection
      id="skipping"
      icon="skipNext"
      title="Skipping"
      desc="This device only. Without these, a Skip card comes up as each intro or the credits start: press it, or S on a keyboard."
    >
      <Toggle label="Skip intros" hint="Jumps past an intro as it starts. A toast lets you go back and watch it." checked={skip.intro} onChange={(v) => change({ intro: v })} />
      <Toggle
        label="Skip credits"
        hint="Goes straight to the next episode when the credits start. A film's credits always play, in case of a final scene."
        checked={skip.credits}
        onChange={(v) => change({ credits: v })}
      />
      <Toggle
        label="Mark filler episodes"
        hint="A Filler badge on anime episodes outside the source story. Each show's MyAnimeList episode list is read through jikan-edge (or Tenrai as a backup) by its ids or title; nothing about you is sent."
        checked={filler.badges}
        onChange={(v) => setFillerPref("badges", v)}
      />
      <Toggle
        label="Fill in missing episode titles"
        hint={`Anime episodes titled only with a file name ("Death Note - 01") get their title from MyAnimeList.${isAdmin ? " As an administrator, the titles are also saved to Jellyfin, so every app shows them." : ""}`}
        checked={filler.names}
        onChange={(v) => setFillerPref("names", v)}
      />
      <Toggle
        label="Skip all filler"
        hint="Next episode, autoplay and a show's Play button pass over filler. You can still pick a filler episode yourself."
        checked={filler.skip}
        onChange={(v) => setFillerPref("skip", v)}
      />
    </SettingsSection>
  );
}

/** Library upkeep that only administrators can do. */
function LibrarySection() {
  const stills = useStillsPref();
  return (
    <SettingsSection id="library" icon="folder" title="Library" desc="For administrators. Changes are saved in Jellyfin, so every app and every user sees them.">
      <Toggle
        label="Use episode stills"
        hint="As you open a season, each episode's picture is replaced, once, with its still from TheMovieDb instead of a frame grabbed from the video. If the library saves artwork into media folders, this replaces the -thumb.jpg beside each video."
        checked={stills}
        onChange={setStillsPref}
      />
    </SettingsSection>
  );
}

/** Settings that only exist in the Argent desktop app. */
function DesktopSection({ info, setSetting, refresh }: { info: DesktopInfo; setSetting: ReturnType<typeof useDesktopInfo>["setSetting"]; refresh: () => void }) {
  const { settings, update } = info;
  const busy = update.state === "checking" || update.state === "downloading";
  return (
    <SettingsSection id="desktop" icon="dashboard" title="Desktop app" desc="This computer only.">
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
      {settings.steadyFullscreenVideo !== undefined && (
        <Toggle
          label="Keep wide movies in shape in full screen"
          hint="Stops movies with black bars stretching for a few seconds when full screen turns on or off. Turn off if playback stutters. Applies after Argent restarts."
          checked={settings.steadyFullscreenVideo}
          onChange={(v) => setSetting("steadyFullscreenVideo", v)}
        />
      )}
      {info.restartNeeded && (
        <div className="setting">
          <div className="setting__text">
            <span className="setting__label">Restart to apply</span>
            <span className="setting__hint">Argent closes and opens again. Anything playing stops.</span>
          </div>
          {desktop?.relaunch && (
            <Button variant="primary" size="sm" onClick={() => desktop?.relaunch?.()}>
              Restart now
            </Button>
          )}
        </div>
      )}
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
    </SettingsSection>
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
  const hasDesktop = Boolean(desktopApp.info);

  // The settings menu, in the same order as the sections.
  const navItems = useMemo(() => {
    const items: (SettingsNavItem | false)[] = [
      { id: "playback", label: "Playback", icon: "play", group: "Watching" },
      { id: "skipping", label: "Skipping", icon: "skipNext", group: "Watching" },
      { id: "coming-up", label: "Coming Up", icon: "calendar", group: "Watching" },
      { id: "display", label: "Display", icon: "eye", group: "Personal" },
      { id: "ratings", label: "Ratings", icon: "star", group: "Personal" },
      { id: "recommendations", label: "Recommendations", icon: "sparkle", group: "Personal" },
      hasDesktop && { id: "desktop", label: "Desktop app", icon: "dashboard", group: "App" },
      Boolean(androidApp) && { id: "android", label: "Android app", icon: "remote", group: "App" },
      isAdmin && { id: "library", label: "Library", icon: "folder", group: "App" },
      { id: "account", label: "Account", icon: "user", group: "Account" },
      { id: "help", label: "Help", icon: "bug", group: "Account" },
    ];
    return items.filter((i): i is SettingsNavItem => Boolean(i));
  }, [hasDesktop, isAdmin]);

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
        <div className="settings">
          <SettingsNav items={navItems} />

          <div className="settings__content">
            <SettingsSection id="playback" icon="play" title="Playback" desc="Saved to your server account, so every app you use follows them.">
              <div className="setting">
                <div className="setting__text">
                  <span className="setting__label">Audio language</span>
                  <span className="setting__hint">Picked when a video has more than one</span>
                </div>
                <select
                  className="select setting__select"
                  aria-label="Preferred audio language"
                  value={cfg.AudioLanguagePreference ?? ""}
                  onChange={(e) => save({ AudioLanguagePreference: e.target.value })}
                >
                  {LANGUAGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting">
                <div className="setting__text">
                  <span className="setting__label">Subtitle language</span>
                </div>
                <select
                  className="select setting__select"
                  aria-label="Preferred subtitle language"
                  value={cfg.SubtitleLanguagePreference ?? ""}
                  onChange={(e) => save({ SubtitleLanguagePreference: e.target.value })}
                >
                  {LANGUAGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting">
                <div className="setting__text">
                  <span className="setting__label">Show subtitles</span>
                </div>
                <select
                  className="select setting__select"
                  aria-label="Subtitles"
                  value={cfg.SubtitleMode ?? "Default"}
                  onChange={(e) => save({ SubtitleMode: e.target.value as UserConfiguration["SubtitleMode"] })}
                >
                  <option value="Default">Default — follow the file</option>
                  <option value="Smart">Smart — when audio isn't in my language</option>
                  <option value="OnlyForced">Forced only</option>
                  <option value="Always">Always</option>
                  <option value="None">Never</option>
                </select>
              </div>
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
            </SettingsSection>

            <SkippingSection />

            <ComingUpSection userId={user.Id} />

            <SettingsSection id="display" icon="eye" title="Display" desc="This device only, unless marked as an account setting.">
              <div className="setting setting--wrap">
                <div className="setting__text">
                  <span className="setting__label">Interface</span>
                  <span className="setting__hint">Automatic picks the layout that suits this device</span>
                </div>
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
            </SettingsSection>

            <SettingsSection id="ratings" icon="star" title="Ratings" desc="This device only. Your ratings themselves sync with your account.">
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
            </SettingsSection>

            <SettingsSection
              id="recommendations"
              icon="sparkle"
              title="Recommendations"
              desc="Built only from your own viewing history and titles in your library. Other users on this server get their own."
            >
              <div className="setting">
                <div className="setting__text">
                  <span className="setting__label">Hidden titles</span>
                  <span className="setting__hint">{dismissedCount ? `${dismissedCount} marked “Not interested”` : "Nothing hidden"}</span>
                </div>
                <Button variant="secondary" size="sm" disabled={!dismissedCount} onClick={() => clearDismissed(user.Id)}>
                  Restore
                </Button>
              </div>
            </SettingsSection>

            {desktopApp.info && <DesktopSection info={desktopApp.info} setSetting={desktopApp.setSetting} refresh={desktopApp.refresh} />}

            {androidApp && <AndroidSection />}

            {isAdmin && <LibrarySection />}

            <SettingsSection id="account" icon="user" title="Account" desc={`Signed in to ${account?.serverName ?? "your server"} as ${user.Name}.`}>
              <div className="settings__actions">
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
            </SettingsSection>

            <HelpSection />
          </div>
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
