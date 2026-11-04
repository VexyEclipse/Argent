import { useState } from "react";
import { desktop, useUpdateStatus } from "@/platform/desktop";
import { Button } from "./Button";
import { Icon } from "./Icon";

/** Desktop app: a new version has downloaded and installs on restart. */
export function UpdatePrompt() {
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!desktop || status?.state !== "ready" || dismissed === status.version) return null;
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
