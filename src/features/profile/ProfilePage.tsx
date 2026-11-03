import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { APP_VERSION } from "@/api/client";
import { client, getPublicInfo, updateUserConfiguration } from "@/api/jellyfin";
import type { UserConfiguration } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { JellyfinMark } from "@/components/JellyfinLogo";
import { clearDismissed, readFeedback, subscribeFeedback } from "@/features/recommendations/feedback";
import { getPlatformOverride, setPlatformOverride, type Platform } from "@/platform/platform";
import "./profile.css";

const LANGUAGES: [string, string][] = [
  ["", "Any / server default"],
  ["eng", "English"],
  ["spa", "Spanish"],
  ["fre", "French"],
  ["ger", "German"],
  ["ita", "Italian"],
  ["por", "Portuguese"],
  ["dut", "Dutch"],
  ["swe", "Swedish"],
  ["nor", "Norwegian"],
  ["dan", "Danish"],
  ["fin", "Finnish"],
  ["pol", "Polish"],
  ["rus", "Russian"],
  ["jpn", "Japanese"],
  ["kor", "Korean"],
  ["chi", "Chinese"],
  ["hin", "Hindi"],
  ["ara", "Arabic"],
  ["tur", "Turkish"],
];

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint && <span className="setting__hint">{hint}</span>}
      </div>
      <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
    </div>
  );
}

export default function ProfilePage() {
  const { user, account, isAdmin, refreshUser, signOut, addAccount } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [platform, setPlatform] = useState<Platform | "auto">(getPlatformOverride);
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
            label="Hide watched items in Recently Added"
            hint="Account setting"
            checked={Boolean(cfg.HidePlayedInLatest)}
            onChange={(v) => save({ HidePlayedInLatest: v })}
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

      <footer className="profile__about">
        <JellyfinMark size={22} />
        <span>
          Argent {APP_VERSION} · {server.data?.ServerName ?? account?.serverName} · Server {server.data?.Version ?? ""}
        </span>
      </footer>
    </div>
  );
}
