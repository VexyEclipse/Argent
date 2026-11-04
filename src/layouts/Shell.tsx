import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { client, getViews } from "@/api/jellyfin";
import { isAnimeLibrary, useLibraryGroups } from "@/api/libraries";
import { useAuth } from "@/auth/AuthProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Icon, type IconName } from "@/components/Icon";
import { JellyfinLogo, JellyfinMark } from "@/components/JellyfinLogo";
import { ToastHost } from "@/components/Toast";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { ManageHost } from "@/features/manage/ManageHost";
import { RatePromptHost } from "@/features/ratings/RatePrompt";
import { useUpcomingSync } from "@/features/upcoming/store";
import { usePlatform } from "@/platform/platform";
import { installSpatialNavigation } from "@/platform/spatialNavigation";

type NavItem = { to: string; label: string; icon: IconName; end?: boolean; /** Left out of the mobile tab bar (it's in the account menu there). */ tabbar?: false };

/** Main sections. Anime appears only when the user has an anime library. */
function useNav(): NavItem[] {
  const { anime } = useLibraryGroups();
  return [
    { to: "/", label: "Home", icon: "home", end: true },
    { to: "/movies", label: "Movies", icon: "film" },
    { to: "/series", label: "Series", icon: "tv" },
    ...(anime.length ? [{ to: "/anime", label: "Anime", icon: "sparkle" as IconName }] : []),
    { to: "/collections", label: "Collections", icon: "stack" },
    { to: "/watchlist", label: "Watchlist", icon: "bookmark", tabbar: false },
  ];
}

/** Views that aren't covered by Movies/Series/Collections get their own entry. */
export function useOtherLibraries() {
  const views = useQuery({ queryKey: ["views"], queryFn: getViews, staleTime: 5 * 60_000 });
  return (views.data?.Items ?? []).filter(
    (v) => !["movies", "tvshows", "boxsets", "playlists", "livetv"].includes(v.CollectionType ?? "") && !isAnimeLibrary(v),
  );
}

function Avatar({ size = 32 }: { size?: number }) {
  const { user } = useAuth();
  if (!user) return null;
  return user.PrimaryImageTag ? (
    <img className="avatar" style={{ width: size, height: size }} src={client().userImageUrl(user.Id, user.PrimaryImageTag, size * 2)} alt="" />
  ) : (
    <span className="avatar" style={{ width: size, height: size }}>
      {user.Name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ProfileMenu() {
  const { user, isAdmin, signOut, addAccount, accounts, switchAccount, account } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const others = useOtherLibraries();
  const location = useLocation();
  const platform = usePlatform();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const otherAccounts = accounts.filter((a) => a.userId !== account?.userId || a.serverId !== account?.serverId);

  return (
    <div className="menu" ref={ref}>
      <button className="nav__avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account">
        <Avatar />
      </button>
      {open && (
        <div className="menu__panel" role="menu">
          <div className="menu__header">
            <Avatar size={40} />
            <div>
              <div className="menu__name">{user?.Name}</div>
              <div className="menu__meta">{account?.serverName}</div>
            </div>
          </div>
          <Link className="menu__item" to="/profile" role="menuitem">
            <Icon name="gear" size={18} /> Profile & settings
          </Link>
          {platform === "mobile" && (
            <Link className="menu__item" to="/watchlist" role="menuitem">
              <Icon name="bookmark" size={18} /> Watchlist
            </Link>
          )}
          {others.length > 0 && <div className="menu__label">Libraries</div>}
          {others.map((v) => (
            <Link key={v.Id} className="menu__item" to={`/library/${v.Id}`} role="menuitem">
              <Icon name="grid" size={18} /> {v.Name}
            </Link>
          ))}
          {isAdmin && (
            <>
              <div className="menu__label">Server</div>
              <a className="menu__item" href={`${client().serverUrl}/web/#/dashboard`} target="_blank" rel="noreferrer" role="menuitem">
                <Icon name="dashboard" size={18} /> Dashboard <Icon name="external" size={14} className="menu__ext" />
              </a>
            </>
          )}
          <div className="menu__label">Users</div>
          {otherAccounts.map((a) => (
            <button key={`${a.serverId}:${a.userId}`} className="menu__item" onClick={() => switchAccount(a)} role="menuitem">
              <Icon name="user" size={18} /> {a.userName}
              <span className="menu__meta menu__meta--inline">{a.serverName}</span>
            </button>
          ))}
          <button className="menu__item" onClick={addAccount} role="menuitem">
            <Icon name="swap" size={18} /> Switch user
          </button>
          <button className="menu__item" onClick={() => signOut()} role="menuitem">
            <Icon name="logout" size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function DesktopNav() {
  const nav = useNav();
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`nav ${solid ? "is-solid" : ""}`}>
      <Link to="/" className="nav__brand" aria-label="Argent home">
        <JellyfinLogo size={26} />
      </Link>
      <nav className="nav__links" aria-label="Main">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav__link">
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="nav__end">
        <NavLink to="/search" className="nav__icon" aria-label="Search">
          <Icon name="search" size={20} />
        </NavLink>
        <ProfileMenu />
      </div>
    </header>
  );
}

function MobileNav() {
  const nav = useNav().filter((n) => n.tabbar !== false);
  return (
    <>
      <header className="mnav">
        <Link to="/" aria-label="Argent home">
          <JellyfinLogo size={24} />
        </Link>
        <ProfileMenu />
      </header>
      <nav className="tabbar" aria-label="Main">
        {[...nav.slice(0, -1), { to: "/search", label: "Search", icon: "search" as IconName }, nav[nav.length - 1]].map((n) => (
          <NavLink key={n.to} to={n.to} end={"end" in n ? n.end : undefined} className="tabbar__item">
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function TvRail() {
  const nav = useNav();
  const others = useOtherLibraries();
  const items: { to: string; label: string; icon: IconName; end?: boolean }[] = [
    { to: "/search", label: "Search", icon: "search" },
    ...nav,
    ...others.map((v) => ({ to: `/library/${v.Id}`, label: v.Name, icon: "grid" as IconName })),
    { to: "/profile", label: "Profile", icon: "user" },
  ];
  return (
    <nav className="rail" aria-label="Main">
      <div className="rail__brand">
        <JellyfinMark size={34} />
      </div>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className="rail__item">
          <Icon name={n.icon} size={26} />
          <span className="rail__label">{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** D-pad navigation for the whole TV app, sign-in included. */
export function useTvNavigation() {
  const platform = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (platform !== "tv") return;
    return installSpatialNavigation(() => {
      if (location.pathname !== "/") navigate(-1);
    });
  }, [platform, navigate, location.pathname]);
}

export function Shell() {
  const platform = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();
  const openSeries = useCallback((id: string) => navigate(`/details/${id}`), [navigate]);
  useUpcomingSync(openSeries);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className={`shell shell--${platform}`}>
      {platform === "desktop" && <DesktopNav />}
      {platform === "mobile" && <MobileNav />}
      {platform === "tv" && <TvRail />}
      <main className="shell__main" id="main">
        {/* A broken screen keeps the navigation, so the rest of the app stays usable. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <RatePromptHost />
      <UpdatePrompt />
      <ManageHost />
      <ToastHost />
    </div>
  );
}
