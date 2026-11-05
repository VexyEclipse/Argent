import { useState } from "react";
import { Outlet } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { JellyfinLogo } from "@/components/JellyfinLogo";
import { ToastHost } from "@/components/Toast";
import { usePlatform } from "@/platform/platform";
import "./downloads.css";

/** The app with no server: just your downloads, and a way to reconnect. */
export function OfflineShell() {
  const { account, reconnect } = useAuth();
  const platform = usePlatform();
  const [trying, setTrying] = useState(false);
  return (
    <div className={`shell shell--${platform} offline-shell`}>
      <header className="offline-bar">
        <JellyfinLogo size={24} />
        <span className="offline-bar__text">
          <strong>Offline</strong> · {account?.serverName ?? "Your server"} can't be reached, so here are your downloads.
        </span>
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          disabled={trying}
          onClick={async () => {
            setTrying(true);
            await reconnect();
            setTrying(false);
          }}
        >
          {trying ? "Connecting…" : "Try again"}
        </Button>
      </header>
      <main className="shell__main" id="main">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}
