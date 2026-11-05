import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, JellyfinClient } from "@/api/client";
import { getMe, getPublicInfo, logout, setClient } from "@/api/jellyfin";
import type { AuthenticationResult, User } from "@/api/types";

export interface Account {
  serverUrl: string;
  serverId: string;
  serverName: string;
  userId: string;
  userName: string;
  accessToken: string;
  primaryImageTag?: string;
}

/** "offline": the server can't be reached, but this account has downloads to watch. */
type Status = "loading" | "signedOut" | "signedIn" | "offline";

interface AuthState {
  status: Status;
  user: User | null;
  account: Account | null;
  accounts: Account[];
  isAdmin: boolean;
  completeSignIn: (serverUrl: string, serverName: string, result: AuthenticationResult) => void;
  switchAccount: (account: Account) => Promise<void>;
  signOut: (opts?: { forget?: boolean }) => Promise<void>;
  addAccount: () => void;
  refreshUser: () => Promise<void>;
  /** Offline: try the server again. */
  reconnect: () => Promise<void>;
}

const ACCOUNTS_KEY = "argent.accounts";
const ACTIVE_KEY = "argent.activeAccount";

function loadAccounts(): Account[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: Account[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* ignore */
  }
}

function accountKey(a: Pick<Account, "serverId" | "userId">) {
  return `${a.serverId}:${a.userId}`;
}

// The last user record seen for each account, so offline mode knows who you are.
const userKey = (a: Pick<Account, "serverId" | "userId">) => `argent.user.${accountKey(a)}`;

function rememberUser(a: Pick<Account, "serverId" | "userId">, user: User) {
  try {
    localStorage.setItem(userKey(a), JSON.stringify({ Id: user.Id, Name: user.Name, ServerId: user.ServerId, PrimaryImageTag: user.PrimaryImageTag, Configuration: user.Configuration }));
  } catch {
    /* ignore */
  }
}

function rememberedUser(a: Account): User {
  try {
    const u = JSON.parse(localStorage.getItem(userKey(a)) || "null");
    if (u?.Id) return u;
  } catch {
    /* ignore */
  }
  return { Id: a.userId, Name: a.userName, ServerId: a.serverId };
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children, hasOfflineContent }: { children: ReactNode; hasOfflineContent?: (account: Account) => boolean }) {
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts);
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const persist = useCallback((next: Account[]) => {
    setAccounts(next);
    saveAccounts(next);
  }, []);

  const activate = useCallback(
    async (target: Account): Promise<boolean> => {
      const c = new JellyfinClient(target.serverUrl, target.accessToken, target.userId);
      try {
        const me = await getMe(c);
        setClient(c);
        queryClient.clear();
        setAccount(target);
        setUser(me);
        setStatus("signedIn");
        rememberUser(target, me);
        try {
          localStorage.setItem(ACTIVE_KEY, accountKey(target));
        } catch {
          /* ignore */
        }
        return true;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          // Token revoked server-side: forget it.
          persist(loadAccounts().filter((a) => accountKey(a) !== accountKey(target)));
        } else if (!(error instanceof ApiError) && hasOfflineContent?.(target)) {
          // Unreachable (no network, server down) with downloads to watch: offline mode.
          setClient(c);
          setAccount(target);
          setUser(rememberedUser(target));
          setStatus("offline");
          return true;
        }
        return false;
      }
    },
    [persist, queryClient],
  );

  // Restore the last active account on boot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadAccounts();
      let activeKey: string | null = null;
      try {
        activeKey = localStorage.getItem(ACTIVE_KEY);
      } catch {
        /* ignore */
      }
      const target = saved.find((a) => accountKey(a) === activeKey) ?? null;
      if (target && (await activate(target))) return;
      if (!cancelled) setStatus("signedOut");
    })();
    return () => {
      cancelled = true;
    };
    // Boot once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any 401 from the API means the session ended elsewhere.
  useEffect(() => {
    const onUnauthorized = () => {
      if (status !== "signedIn") return;
      setStatus("signedOut");
      setUser(null);
      setAccount(null);
      setClient(null);
    };
    window.addEventListener("argent:unauthorized", onUnauthorized);
    return () => window.removeEventListener("argent:unauthorized", onUnauthorized);
  }, [status]);

  const completeSignIn = useCallback(
    (serverUrl: string, serverName: string, result: AuthenticationResult) => {
      const next: Account = {
        serverUrl,
        serverId: result.ServerId,
        serverName,
        userId: result.User.Id,
        userName: result.User.Name,
        accessToken: result.AccessToken,
        primaryImageTag: result.User.PrimaryImageTag,
      };
      const others = loadAccounts().filter((a) => accountKey(a) !== accountKey(next));
      persist([next, ...others]);
      const c = new JellyfinClient(serverUrl, result.AccessToken, result.User.Id);
      setClient(c);
      queryClient.clear();
      setAccount(next);
      setUser(result.User);
      setStatus("signedIn");
      rememberUser(next, result.User);
      try {
        localStorage.setItem(ACTIVE_KEY, accountKey(next));
      } catch {
        /* ignore */
      }
    },
    [persist, queryClient],
  );

  const switchAccount = useCallback(
    async (target: Account) => {
      setStatus("loading");
      if (!(await activate(target))) setStatus("signedOut");
    },
    [activate],
  );

  const signOut = useCallback(
    async ({ forget = true }: { forget?: boolean } = {}) => {
      if (account) {
        try {
          await logout(new JellyfinClient(account.serverUrl, account.accessToken, account.userId));
        } catch {
          /* server may be unreachable; still sign out locally */
        }
        if (forget) persist(loadAccounts().filter((a) => accountKey(a) !== accountKey(account)));
      }
      try {
        localStorage.removeItem(ACTIVE_KEY);
      } catch {
        /* ignore */
      }
      setClient(null);
      queryClient.clear();
      setUser(null);
      setAccount(null);
      setStatus("signedOut");
    },
    [account, persist, queryClient],
  );

  const addAccount = useCallback(() => {
    // Leave the current token saved; just show the sign-in screen.
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    setClient(null);
    queryClient.clear();
    setUser(null);
    setAccount(null);
    setStatus("signedOut");
  }, [queryClient]);

  const reconnect = useCallback(async () => {
    if (account) await activate(account);
  }, [account, activate]);

  const refreshUser = useCallback(async () => {
    if (!account) return;
    const c = new JellyfinClient(account.serverUrl, account.accessToken, account.userId);
    setUser(await getMe(c));
  }, [account]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      account,
      accounts,
      isAdmin: Boolean(user?.Policy?.IsAdministrator),
      completeSignIn,
      switchAccount,
      signOut,
      addAccount,
      refreshUser,
      reconnect,
    }),
    [status, user, account, accounts, completeSignIn, switchAccount, signOut, addAccount, refreshUser, reconnect],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** Validate a server URL by reading its public info. */
export async function probeServer(url: string, signal?: AbortSignal) {
  const c = new JellyfinClient(url);
  const info = await getPublicInfo(c, signal);
  return { client: c, info };
}
