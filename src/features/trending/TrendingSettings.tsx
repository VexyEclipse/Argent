import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { SettingsSection } from "@/features/profile/SettingsLayout";
import { Toggle } from "@/features/profile/Toggle";
import { checkTmdbKey, useSetTrendingPref, useTmdbKey, useTrendingPrefs } from "./store";
import "./trending.css";

type Check = "idle" | "checking" | "ok" | "rejected" | "unreachable";

/** Settings → Top 10: which lists, titles you don't have, and the TMDB key. */
export function TrendingSettings() {
  const prefs = useTrendingPrefs();
  const set = useSetTrendingPref();
  const { source } = useTmdbKey();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<Check>("idle");
  const hasKey = Boolean(source);

  const saveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = draft.trim();
    if (!key) return;
    setCheck("checking");
    const ok = await checkTmdbKey(key);
    if (ok === false) {
      setCheck("rejected");
      return;
    }
    // Couldn't reach TMDB to check: keep it anyway, it's most likely fine.
    set("tmdbKey", key);
    setDraft("");
    setCheck(ok ? "ok" : "unreachable");
    qc.invalidateQueries({ queryKey: ["trending"] });
  };

  const removeKey = () => {
    set("tmdbKey", "");
    setCheck("idle");
    qc.invalidateQueries({ queryKey: ["trending"] });
  };

  const keyHint =
    check === "checking"
      ? "Checking the key with TMDB…"
      : check === "rejected"
        ? "TMDB didn't accept that key. Copy the API key (or read access token) from themoviedb.org → Settings → API."
        : check === "unreachable"
          ? "Saved. TMDB couldn't be reached to check it, so it'll be tried when the list loads."
          : check === "ok"
            ? "Key works. Films and series are on."
            : source === "you"
              ? "Your key is saved to your account, so your other devices use it too."
              : source === "host"
                ? "Your server's host has set a key for everyone. Add your own to use it instead."
                : "A free key from themoviedb.org (Settings → API) adds trending films and series.";

  return (
    <SettingsSection
      id="top-10"
      icon="trending"
      title="Top 10"
      desc="Saved to your account. Anime comes from AniList and needs no key; films and series come from TMDB. Only the lists are fetched: matching them to your library happens on this device, and nothing about your library or account is sent."
    >
      <Toggle label="Show Top 10 on the home page" checked={prefs.home} onChange={(v) => set("home", v)} />
      <Toggle label="Anime" hint="Trending on AniList this week" checked={prefs.anime} onChange={(v) => set("anime", v)} />
      <Toggle
        label="Movies"
        hint={hasKey ? "Trending on TMDB this week" : "Needs a TMDB key"}
        checked={prefs.movies && hasKey}
        disabled={!hasKey}
        onChange={(v) => set("movies", v)}
      />
      <Toggle
        label="Series"
        hint={hasKey ? "Trending on TMDB this week (anime stays in Anime)" : "Needs a TMDB key"}
        checked={prefs.series && hasKey}
        disabled={!hasKey}
        onChange={(v) => set("series", v)}
      />
      <Toggle
        label="Include titles not in your library"
        hint="Shown with a “Not in library” tag. Off: only yours, ranked among themselves."
        checked={prefs.notOwned}
        onChange={(v) => set("notOwned", v)}
      />
      <div className="setting setting--wrap">
        <div className="setting__text">
          <span className="setting__label">TMDB API key</span>
          <span className={`setting__hint ${check === "rejected" ? "setting__hint--warn" : ""}`} aria-live="polite">
            {keyHint}
          </span>
        </div>
        <form className="tmdb-key" onSubmit={saveKey}>
          <input
            className="input tmdb-key__input"
            type="password"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (check === "rejected") setCheck("idle");
            }}
            placeholder={source === "you" ? "•••••••• saved" : "Paste your key"}
            autoComplete="off"
            spellCheck={false}
            aria-label="TMDB API key"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim() || check === "checking"}>
            {check === "checking" ? "Checking…" : "Save"}
          </Button>
          {source === "you" && (
            <Button variant="ghost" size="sm" onClick={removeKey}>
              Remove
            </Button>
          )}
        </form>
      </div>
    </SettingsSection>
  );
}
