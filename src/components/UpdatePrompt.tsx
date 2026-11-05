import { useState } from "react";
import { androidApp } from "@/platform/android";
import { installAndroidUpdate, useAndroidUpdate, useAndroidUpdateCheck } from "@/platform/androidUpdate";
import { desktop, useUpdateStatus } from "@/platform/desktop";
import { Button } from "./Button";
import { Icon } from "./Icon";

/** A new version of the app: ready to install on restart (desktop) or to download and install (Android). */
export function UpdatePrompt() {
  if (desktop) return <DesktopUpdatePrompt />;
  if (androidApp?.installUpdate) return <AndroidUpdatePrompt />;
  return null;
}

function DesktopUpdatePrompt() {
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (status?.state !== "ready" || dismissed === status.version) return null;
  return (
    <div className="update-prompt" role="status">
      <Icon name="download" size={18} />
      <span>Argent {status.version} is ready to install.</span>
      <Button variant="primary" size="sm" onClick={() => desktop?.installUpdate()}>
        Restart now
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(status.version)} aria-label="Later (installs when you quit)" title="Installs when you quit">
        Later
      </Button>
    </div>
  );
}

function AndroidUpdatePrompt() {
  useAndroidUpdateCheck();
  const status = useAndroidUpdate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!("version" in status) || dismissed === status.version) return null;
  const text =
    status.state === "downloading"
      ? `Downloading Argent ${status.version}… ${status.percent}%`
      : status.state === "installing"
        ? `Installing Argent ${status.version}…`
        : status.state === "permission"
          ? "Allow Argent to install apps in the settings that opened, then press Install again."
          : `Argent ${status.version} is available.`;
  const canInstall = status.state === "available" || status.state === "permission";
  return (
    <div className="update-prompt" role="status">
      <Icon name="download" size={18} />
      <span>{text}</span>
      {canInstall && (
        <Button variant="primary" size="sm" onClick={installAndroidUpdate}>
          Install
        </Button>
      )}
      {canInstall && (
        <Button variant="ghost" size="sm" onClick={() => setDismissed(status.version)}>
          Later
        </Button>
      )}
    </div>
  );
}
