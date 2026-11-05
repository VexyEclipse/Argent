import { useState } from "react";
import { Button } from "@/components/Button";
import { recentEvents } from "@/features/diagnostics/log";
import { buildDiagnostics, copyText, saveText } from "@/features/diagnostics/report";
import { hasNativePlayer } from "@/features/player/external";
import { readEngine, readMatchFrameRate, saveEngine, saveMatchFrameRate } from "@/features/player/prefs";
import { appVersion, checkAndroidUpdate, installAndroidUpdate, readAutoUpdate, setAutoUpdate, useAndroidUpdate, type AndroidUpdateStatus } from "@/platform/androidUpdate";
import { Toggle } from "./Toggle";

function androidUpdateLabel(status: AndroidUpdateStatus): string {
  switch (status.state) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return "You're on the latest version";
    case "available":
      return `Version ${status.version} is available`;
    case "downloading":
      return `Downloading ${status.version}… ${status.percent}%`;
    case "installing":
      return `Installing ${status.version}: confirm on screen`;
    case "permission":
      return "Allow Argent to install apps in Settings, then press Install again";
    case "error":
      return `Couldn't update: ${status.message}`;
    case "unsupported":
      return "Install the latest APK once to get updates here";
    default:
      return "New versions come from Argent's releases on GitHub";
  }
}

/** Settings that only exist in the Android app: its own player and its updates. */
export function AndroidSection() {
  const update = useAndroidUpdate();
  const [engine, setEngine] = useState(readEngine);
  const [matchRate, setMatchRate] = useState(readMatchFrameRate);
  const [auto, setAuto] = useState(readAutoUpdate);
  const busy = update.state === "checking" || update.state === "downloading" || update.state === "installing";
  return (
    <section className="panel profile__section">
      <h2 className="profile__title">Android app</h2>
      <p className="profile__desc">This device only.</p>
      {hasNativePlayer() ? (
        <>
          <Toggle
            label="Use the native player"
            hint="Plays HDR and Dolby Vision, sends surround sound to your receiver, and reads every subtitle format without converting"
            checked={engine === "native"}
            onChange={(v) => {
              setEngine(v ? "native" : "web");
              saveEngine(v ? "native" : "web");
            }}
          />
          {engine === "native" && (
            <Toggle
              label="Match the TV's frame rate"
              hint="Switches the display to the video's rate (24p, 25p…) for smooth motion. Some TVs go dark for a moment."
              checked={matchRate}
              onChange={(v) => {
                setMatchRate(v);
                saveMatchFrameRate(v);
              }}
            />
          )}
        </>
      ) : (
        <p className="profile__desc">Install the latest APK to get the native player (HDR, Dolby Vision, surround passthrough).</p>
      )}
      <div className="setting">
        <div className="setting__text">
          <span className="setting__label">Argent {appVersion() ?? ""}</span>
          <span className="setting__hint">{androidUpdateLabel(update)}</span>
        </div>
        {update.state === "available" || update.state === "permission" ? (
          <Button variant="primary" size="sm" onClick={installAndroidUpdate}>
            Install
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={busy || update.state === "unsupported"} onClick={() => checkAndroidUpdate()}>
            Check now
          </Button>
        )}
      </div>
      <Toggle
        label="Check for updates automatically"
        hint="You still choose when to install, and Android asks to confirm"
        checked={auto}
        onChange={(v) => {
          setAuto(v);
          setAutoUpdate(v);
        }}
      />
    </section>
  );
}

/** A report of this device, its setup and what the player did, for bug reports. */
export function HelpSection() {
  const [state, setState] = useState<"idle" | "copied" | "failed" | "saved">("idle");
  const problems = recentEvents().filter((e) => e.level !== "info").length;
  const tv = document.documentElement.dataset.platform === "tv";
  const hint = {
    copied: "Copied. Paste it into your bug report.",
    saved: "Saved to your downloads.",
    failed: "This device can't copy. Save it as a file instead.",
    idle: problems ? `${problems} problem${problems === 1 ? "" : "s"} noted since Argent opened` : "Nothing has gone wrong since Argent opened",
  }[state];
  return (
    <section className="panel profile__section">
      <h2 className="profile__title">Help</h2>
      <p className="profile__desc">
        Reporting a problem? Diagnostics say what this device can play, how it's set up and what the player did recently. No passwords or access tokens are included.
      </p>
      <div className="setting">
        <div className="setting__text">
          <span className="setting__label">Diagnostics</span>
          <span className="setting__hint">{hint}</span>
        </div>
        <div className="profile__inline-actions">
          {!tv && (
            <Button variant="secondary" size="sm" icon="copy" onClick={async () => setState((await copyText(await buildDiagnostics())) ? "copied" : "failed")}>
              Copy
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            onClick={async () => {
              saveText(await buildDiagnostics());
              setState("saved");
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}
