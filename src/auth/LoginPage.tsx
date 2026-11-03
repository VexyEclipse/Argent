import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, normaliseServerUrl, type JellyfinClient } from "@/api/client";
import { authenticateByName, authenticateWithQuickConnect, getPublicUsers, quickConnectEnabled, quickConnectInitiate, quickConnectState } from "@/api/jellyfin";
import type { PublicSystemInfo, User } from "@/api/types";
import { Button } from "@/components/Button";
import { JellyfinLogo } from "@/components/JellyfinLogo";
import { loadAppConfig } from "@/config/appConfig";
import { probeServer, useAuth, type Account } from "./AuthProvider";
import "./login.css";

const LAST_SERVER_KEY = "argent.lastServer";

type Step = { kind: "server" } | { kind: "user"; client: JellyfinClient; info: PublicSystemInfo };

function defaultServerGuess(): string {
  try {
    const last = localStorage.getItem(LAST_SERVER_KEY);
    if (last) return last;
  } catch {
    /* ignore */
  }
  return "";
}

export function LoginPage() {
  const { accounts, switchAccount } = useAuth();
  const [step, setStep] = useState<Step>({ kind: "server" });
  const appConfig = useQuery({ queryKey: ["app-config"], queryFn: loadAppConfig, staleTime: Infinity });

  return (
    <div className="login">
      <div className="login__backdrop" aria-hidden="true" />
      <div className="login__panel fade-in" data-nav-trap>
        <div className="login__brand">
          <JellyfinLogo size={40} />
        </div>
        {step.kind === "server" ? (
          <>
            {accounts.length > 0 && <SavedAccounts accounts={accounts} onPick={switchAccount} />}
            <ServerStep
              initial={defaultServerGuess() || appConfig.data?.defaultServerUrl || ""}
              autoConnect={Boolean(appConfig.data?.defaultServerUrl) && !accounts.length}
              onConnected={(client, info) => setStep({ kind: "user", client, info })}
            />
          </>
        ) : (
          <UserStep client={step.client} info={step.info} onBack={() => setStep({ kind: "server" })} />
        )}
      </div>
    </div>
  );
}

function SavedAccounts({ accounts, onPick }: { accounts: Account[]; onPick: (a: Account) => void }) {
  return (
    <div className="login__section">
      <h2 className="login__heading">Who's watching?</h2>
      <div className="login__accounts">
        {accounts.map((a) => (
          <button key={`${a.serverId}:${a.userId}`} className="login__account" onClick={() => onPick(a)}>
            <span className="login__avatar">{a.userName.slice(0, 1).toUpperCase()}</span>
            <span className="login__account-name">{a.userName}</span>
            <span className="login__account-server">{a.serverName}</span>
          </button>
        ))}
      </div>
      <div className="login__divider">
        <span>or connect another</span>
      </div>
    </div>
  );
}

function ServerStep({
  initial,
  autoConnect,
  onConnected,
}: {
  initial: string;
  autoConnect: boolean;
  onConnected: (c: JellyfinClient, info: PublicSystemInfo) => void;
}) {
  const [url, setUrl] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    if (initial && !url) setUrl(initial);
  }, [initial, url]);

  const connect = async (value: string) => {
    const target = normaliseServerUrl(value);
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const { client, info } = await probeServer(target, AbortSignal.timeout(8000));
      try {
        localStorage.setItem(LAST_SERVER_KEY, target);
      } catch {
        /* ignore */
      }
      onConnected(client, info);
    } catch {
      setError("Couldn't reach a Jellyfin server at that address.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (autoConnect && initial && !tried.current) {
      tried.current = true;
      connect(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, initial]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect(url);
  };

  return (
    <form className="login__section" onSubmit={submit}>
      <h1 className="login__title">Connect to your server</h1>
      <label className="field">
        <span className="field__label">Server address</span>
        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.1.10:8096"
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          autoFocus
          data-autofocus
        />
      </label>
      {error && <p className="login__error">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || !url.trim()}>
        {busy ? "Connecting…" : "Continue"}
      </Button>
    </form>
  );
}

function UserStep({ client, info, onBack }: { client: JellyfinClient; info: PublicSystemInfo; onBack: () => void }) {
  const { completeSignIn } = useAuth();
  const [mode, setMode] = useState<"password" | "quick">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<{ code: string; secret: string } | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const users = useQuery({ queryKey: ["public-users", client.serverUrl], queryFn: () => getPublicUsers(client), staleTime: 60_000 });
  const qcEnabled = useQuery({ queryKey: ["qc-enabled", client.serverUrl], queryFn: () => quickConnectEnabled(client).catch(() => false) });

  // Quick Connect: show a code, poll until the user approves it from a signed-in device.
  useEffect(() => {
    if (mode !== "quick") return;
    let cancelled = false;
    let timer = 0;
    (async () => {
      try {
        const init = await quickConnectInitiate(client);
        if (cancelled) return;
        setQuick({ code: init.Code, secret: init.Secret });
        const poll = async () => {
          if (cancelled) return;
          try {
            const state = await quickConnectState(client, init.Secret);
            if (state.Authenticated) {
              const result = await authenticateWithQuickConnect(client, init.Secret);
              if (!cancelled) completeSignIn(client.serverUrl, info.ServerName, result);
              return;
            }
          } catch {
            /* transient */
          }
          timer = window.setTimeout(poll, 3000);
        };
        timer = window.setTimeout(poll, 3000);
      } catch {
        if (!cancelled) setError("Quick Connect is unavailable on this server.");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, client, info.ServerName, completeSignIn]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authenticateByName(client, username.trim(), password);
      completeSignIn(client.serverUrl, info.ServerName, result);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That username or password isn't right." : "Sign-in failed. Check the server and try again.");
    } finally {
      setBusy(false);
    }
  };

  const pickUser = (u: User) => {
    setUsername(u.Name);
    setMode("password");
    setTimeout(() => passwordRef.current?.focus(), 0);
  };

  return (
    <div className="login__section">
      <button className="login__server" onClick={onBack} type="button">
        <span className="eyebrow">Server</span>
        <span>{info.ServerName}</span>
        <span className="login__server-change">Change</span>
      </button>

      {users.data && users.data.length > 0 && (
        <div className="login__accounts">
          {users.data.map((u) => (
            <button key={u.Id} className={`login__account ${username === u.Name ? "is-active" : ""}`} onClick={() => pickUser(u)} type="button">
              {u.PrimaryImageTag ? (
                <img className="login__avatar" src={client.userImageUrl(u.Id, u.PrimaryImageTag)} alt="" />
              ) : (
                <span className="login__avatar">{u.Name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className="login__account-name">{u.Name}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "password" ? (
        <form className="login__form" onSubmit={submit}>
          <h1 className="login__title">Sign in</h1>
          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              data-autofocus
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              ref={passwordRef}
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="login__error">{error}</p>}
          <Button variant="primary" type="submit" disabled={busy || !username.trim()}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          {qcEnabled.data && (
            <Button variant="ghost" onClick={() => setMode("quick")}>
              Use Quick Connect
            </Button>
          )}
        </form>
      ) : (
        <div className="login__form">
          <h1 className="login__title">Quick Connect</h1>
          <p className="muted">On a device where you're signed in, open Jellyfin's Quick Connect and enter this code.</p>
          <div className="login__code" aria-live="polite">
            {quick ? quick.code : "······"}
          </div>
          {error && <p className="login__error">{error}</p>}
          <Button variant="ghost" onClick={() => setMode("password")}>
            Sign in with a password
          </Button>
        </div>
      )}
    </div>
  );
}
