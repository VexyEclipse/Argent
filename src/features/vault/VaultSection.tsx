import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router";
import { client } from "@/api/jellyfin";
import type { BaseItem, User } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { blurHashToDataUrl } from "@/components/blurhash";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { showToast } from "@/components/Toast";
import { openDialog } from "@/features/manage/store";
import { SettingsSection } from "@/features/profile/SettingsLayout";
import { download } from "@/features/ratings/transfer";
import { usePlatform } from "@/platform/platform";
import { useKeptPoster } from "./artwork";
import { LibraryAccess } from "./LibraryAccess";
import {
  filterRows,
  rows as toRows,
  seasonLabel,
  shortSeasons,
  shortId,
  statsOf,
  toCsv,
  toJson,
  type VaultFilter,
  type VaultKind,
  type VaultRow,
  type VaultSort,
} from "./logic";
import { checkVault, forgetInVault, hideInVault, importVaultFile, markVisited, useCheckStatus, useVault, useVaultMeta } from "./store";
import { UserAvatar, useServerUsers } from "./VisibilityDialog";
import "./vault.css";

const PAGE = 24;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function ago(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : shortDate(ms);
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function runtime(minutes?: number): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
}

/** The poster: the server's while the title is there, the kept copy once it's gone. */
function VaultPoster({ row, userId }: { row: VaultRow; userId: string }) {
  const { entry, status, key } = row;
  const gone = status === "missing";
  const kept = useKeptPoster(userId, key, gone || !entry.tag);
  const [failed, setFailed] = useState(false);
  const live = !gone && entry.tag && !failed ? client().imageUrl(entry.id, "Primary", { tag: entry.tag, maxWidth: 180, quality: 85 }) : undefined;
  const src = live ?? kept;
  const blur = blurHashToDataUrl(entry.blur);
  return (
    <div className="vcard__poster" style={blur ? { backgroundImage: `url("${blur}")` } : undefined} aria-hidden="true">
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => live && setFailed(true)} />
      ) : (
        !blur && <span className="vcard__initial">{entry.name.slice(0, 1)}</span>
      )}
      {gone && (
        <span className="vcard__gone">
          <Icon name="eyeOff" size={16} />
        </span>
      )}
    </div>
  );
}

interface CardProps {
  row: VaultRow;
  userId: string;
  admin: boolean;
  users: Map<string, User>;
  isNew: boolean;
  /** TV and touch: actions always showing. */
  showActions: boolean;
}

const VaultCard = memo(function VaultCard({ row, userId, admin, users, isNew, showActions }: CardProps) {
  const { entry: e, status, key } = row;
  const show = e.type === "Series";
  const years = e.year ? (e.endYear && e.endYear !== e.year ? `${e.year}–${e.endYear}` : String(e.year)) : "";
  const meta = [years, show ? "Show" : "Movie", e.genres?.[0]].filter(Boolean).join(" · ");
  const short = status === "incomplete" ? shortSeasons(e) : [];
  const watchedPct = show ? (e.episodes ? Math.min(100, ((e.watched ?? 0) / e.episodes) * 100) : 0) : e.played ? 100 : (e.progress ?? 0);
  const hiddenFrom = (e.hiddenFrom ?? []).map((s) => users.get(s)).filter((u): u is User => Boolean(u));
  const restricted = admin && Boolean(e.hiddenFrom?.length || e.owner);
  const ownerIsMe = e.owner && e.owner === shortId(userId);

  const progressText = show
    ? e.watched
      ? e.played
        ? "All watched"
        : `${e.watched} of ${e.episodes ?? e.most ?? "?"} watched`
      : "Not started"
    : e.played
      ? "Watched"
      : e.progress
        ? `${e.progress}% watched`
        : "Not watched";

  const visibility = () => openDialog("visibility", [{ Id: e.id, Name: e.name, Type: e.type } as BaseItem]);

  return (
    <article className={`vcard vcard--${status} ${e.hidden ? "is-hidden" : ""} ${showActions ? "has-actions" : ""}`} aria-label={e.name}>
      <VaultPoster row={row} userId={userId} />
      <div className="vcard__body">
        <div className="vcard__head">
          <h3 className="vcard__title">
            {status !== "missing" ? (
              <Link to={`/details/${e.id}`} className="vcard__link">
                {e.name}
              </Link>
            ) : (
              e.name
            )}
          </h3>
          {isNew && <span className="vcard__new">New</span>}
        </div>
        {meta && <p className="vcard__meta">{meta}</p>}
        <p className="vcard__count">
          {show ? (
            <>
              <strong>{plural(status === "missing" ? (e.most ?? e.episodes ?? 0) : (e.episodes ?? 0), "episode")}</strong>
              {e.seasons ? <span> · {plural(e.seasons, "season")}</span> : null}
            </>
          ) : (
            <strong>{runtime(e.minutes) || "Film"}</strong>
          )}
        </p>
        <div className="vcard__progress" title={progressText}>
          <span className="vcard__bar">
            <span style={{ width: `${watchedPct}%` }} />
          </span>
          <span className="vcard__progress-text">{progressText}</span>
        </div>
        {status === "missing" && show && e.last && <p className="vcard__last">Left off at {e.last.code}{e.last.name ? ` · ${e.last.name}` : ""}</p>}
        <div className="vcard__tags">
          {status === "library" && <span className="vpill vpill--library">In library</span>}
          {status === "missing" && <span className="vpill vpill--missing">Missing since {shortDate(e.missing!)}</span>}
          {status === "incomplete" && (
            <span className="vpill vpill--incomplete" title={short.map((s) => `${seasonLabel(s.season)}: ${s.now} of ${s.had}`).join("\n")}>
              Incomplete · {e.episodes} of {e.most}
            </span>
          )}
          {e.rating ? (
            <span className="vcard__rating" aria-label={`Your rating ${e.rating} out of 10`}>
              <Icon name="star" size={12} /> {e.rating}
            </span>
          ) : null}
          {restricted && (
            <button className="vpill vpill--lock" onClick={visibility} title={hiddenFrom.length ? `Hidden from ${hiddenFrom.map((u) => u.Name).join(", ")}` : undefined}>
              <Icon name="lock" size={12} />
              {e.owner ? (ownerIsMe ? "Only you" : `Only ${users.get(e.owner)?.Name ?? "its owner"}`) : `Hidden from ${hiddenFrom.length || e.hiddenFrom?.length}`}
              {!e.owner && hiddenFrom.length > 0 && (
                <span className="vpill__faces">
                  {hiddenFrom.slice(0, 3).map((u) => (
                    <UserAvatar key={u.Id} user={u} size={16} />
                  ))}
                </span>
              )}
            </button>
          )}
        </div>
        {short.length > 0 && (
          <p className="vcard__short">
            {short
              .slice(0, 2)
              .map((s) => `${seasonLabel(s.season)}: ${s.now} of ${s.had}`)
              .join(" · ")}
            {short.length > 2 ? ` · ${short.length - 2} more` : ""}
          </p>
        )}
      </div>
      <div className="vcard__actions">
        {admin && status !== "missing" && !e.hidden && (
          <button className="vcard__action" onClick={visibility} aria-label={`Who can see ${e.name}`} title="Who can see this">
            <Icon name="lock" size={16} />
          </button>
        )}
        {e.hidden ? (
          <>
            <button className="vcard__action" onClick={() => hideInVault(userId, key, false)} aria-label={`Restore ${e.name}`} title="Restore">
              <Icon name="eye" size={16} />
            </button>
            <button
              className="vcard__action vcard__action--danger"
              onClick={() => {
                forgetInVault(userId, [key]);
                showToast(`${e.name} is out of your Vault`);
              }}
              aria-label={`Remove ${e.name} from the Vault`}
              title="Remove from the Vault"
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        ) : (
          <button
            className="vcard__action"
            onClick={() => {
              hideInVault(userId, key, true);
              showToast(`${e.name} moved to Hidden`, { label: "Undo", run: () => hideInVault(userId, key, false) });
            }}
            aria-label={`Hide ${e.name} in the Vault`}
            title="Hide"
          >
            <Icon name="eyeOff" size={16} />
          </button>
        )}
      </div>
    </article>
  );
});

function Stat({ value, label, tone, active, onClick }: { value: number; label: string; tone?: "missing" | "incomplete"; active?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <span className="vstat__value" title={value >= 10_000 ? value.toLocaleString() : undefined}>
        {value >= 10_000 ? compact.format(value) : value.toLocaleString()}
      </span>
      <span className="vstat__label">{label}</span>
    </>
  );
  const cls = `vstat ${tone && value ? `vstat--${tone}` : ""} ${active ? "is-active" : ""}`;
  return onClick ? (
    <button className={cls} onClick={onClick} aria-pressed={active}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

const SORTS: [VaultSort, string][] = [
  ["added", "Recently added"],
  ["name", "Name"],
  ["missing", "Missing first"],
  ["size", "Largest"],
];

/** Settings → Vault: every title you've had, what's gone, and (administrators) who can see what. */
export function VaultSection() {
  const { user, isAdmin } = useAuth();
  const userId = user?.Id ?? "";
  const state = useVault();
  const meta = useVaultMeta();
  const check = useCheckStatus();
  const platform = usePlatform();
  const usersQuery = useServerUsers(isAdmin);
  const users = useMemo(() => new Map((usersQuery.data ?? []).map((u) => [shortId(u.Id), u])), [usersQuery.data]);
  const [filter, setFilter] = useState<VaultFilter>("all");
  const [kind, setKind] = useState<VaultKind>("all");
  const [sort, setSort] = useState<VaultSort>("added");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const sectionRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Titles missing since the last visit stay marked New while you're here.
  const [visitedAt] = useState(meta.visitedAt);

  const all = useMemo(() => toRows(state), [state]);
  const stats = useMemo(() => statsOf(all), [all]);
  const list = useMemo(() => filterRows(all, { filter, kind, query: deferredQuery, sort }), [all, filter, kind, deferredQuery, sort]);
  const counts = useMemo(() => {
    const scoped = all.filter((r) => kind === "all" || r.entry.type === kind);
    const n = (f: VaultFilter) => filterRows(scoped, { filter: f, kind: "all", query: "", sort: "name" }).length;
    return { all: n("all"), library: n("library"), missing: n("missing"), incomplete: n("incomplete"), hidden: n("hidden"), restricted: n("restricted") };
  }, [all, kind]);

  useEffect(() => setShown(PAGE), [filter, kind, deferredQuery, sort]);

  // Seeing the Vault clears the "went missing" news.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !userId || typeof IntersectionObserver === "undefined") return;
    let timer = 0;
    const io = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer);
      if (entry.isIntersecting) timer = window.setTimeout(() => markVisited(userId), 1500);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [userId]);

  const runCheck = async () => {
    const first = all.length === 0;
    const r = await checkVault(userId, isAdmin);
    if (!r.ok) return;
    const news = [
      r.missing && `${plural(r.missing, "title")} left your library`,
      r.returned && `${plural(r.returned, "title")} came back`,
      r.added && !first && `${plural(r.added, "new title")} added`,
    ].filter(Boolean);
    showToast(first ? `Your Vault now keeps ${plural(r.added, "title")}` : news.length ? `${news.join(" · ")}` : "Your Vault is up to date");
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const exportCsv = () => download(toCsv(filterRows(all, { filter: "all", kind: "all", query: "", sort: "name" })), `argent-vault-${stamp}.csv`, "text/csv");
  const exportJson = () => download(toJson(state), `argent-vault-${stamp}.json`, "application/json");
  const onImport = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    const added = importVaultFile(userId, await file.text());
    if (added === null) return showToast("That isn't a Vault backup. Choose a .json file saved with Back up.");
    showToast(added ? `Added ${plural(added, "title")}. Checking which are in your library…` : "Nothing new in that backup");
    if (added) void checkVault(userId, isAdmin);
  };

  const empty = all.length === 0;
  const status = check.checking ? "Checking your library…" : check.error ? check.error : meta.checkedAt ? `Checked ${ago(meta.checkedAt)}` : "Not checked yet";
  const showActions = platform !== "desktop";

  const filters: [VaultFilter, string, number][] = [
    ["all", "All", counts.all],
    ["library", "In library", counts.library],
    ["missing", "Missing", counts.missing],
    ["incomplete", "Incomplete", counts.incomplete],
    ["hidden", "Hidden", counts.hidden],
    ...(isAdmin ? ([["restricted", "Restricted", counts.restricted]] as [VaultFilter, string, number][]) : []),
  ];

  return (
    <SettingsSection
      id="vault"
      icon="vault"
      title="Vault"
      bare
      desc="Every show and film you've had in your library, kept on this device and your account. If a title disappears (a failed drive, a removed folder) it stays here, marked Missing, with your progress. A title leaves the Vault when you delete it in Argent or hide it here."
    >
      <div className="panel vault" ref={sectionRef}>
        <div className="vault__top">
          <div className="vault__stats">
            <Stat value={stats.shows} label={stats.shows === 1 ? "Show" : "Shows"} />
            <Stat value={stats.movies} label={stats.movies === 1 ? "Movie" : "Movies"} />
            <Stat value={stats.episodes} label="Episodes" />
            <Stat value={stats.missing} label="Missing" tone="missing" active={filter === "missing"} onClick={() => setFilter(filter === "missing" ? "all" : "missing")} />
            <Stat
              value={stats.incomplete}
              label="Incomplete"
              tone="incomplete"
              active={filter === "incomplete"}
              onClick={() => setFilter(filter === "incomplete" ? "all" : "incomplete")}
            />
          </div>
          <div className="vault__check">
            <span className={`vault__status ${check.error ? "is-error" : ""}`} aria-live="polite">
              {check.checking && <span className="vault__pulse" aria-hidden="true" />}
              {status}
            </span>
            <Button variant="secondary" size="sm" icon="refresh" className={check.checking ? "is-spinning" : ""} disabled={check.checking || !userId} onClick={runCheck}>
              Check now
            </Button>
          </div>
        </div>

        {empty ? (
          <div className="vault__empty">
            <span className="vault__empty-icon">
              <Icon name="vault" size={28} />
            </span>
            <p className="vault__empty-title">{check.checking ? "Filling your Vault…" : "Your Vault is empty"}</p>
            <p className="vault__empty-body">
              {check.checking
                ? "Argent is listing every show and film in your library. It only takes a moment."
                : "Argent checks your library every few hours. Check now to fill it straight away."}
            </p>
          </div>
        ) : (
          <>
            <div className="vault__toolbar">
              <div className="vault__filters" role="tablist" aria-label="Show">
                {filters.map(([f, label, n]) =>
                  (f === "hidden" || f === "restricted") && !n && filter !== f ? null : (
                    <button key={f} role="tab" aria-selected={filter === f} className={`chip vault__chip ${filter === f ? "is-active" : ""} ${f === "missing" && n ? "has-news" : ""}`} onClick={() => setFilter(f)}>
                      {label}
                      <span className="vault__chip-count">{n}</span>
                    </button>
                  ),
                )}
              </div>
              <div className="vault__controls">
                <div className="tabs vault__kinds" role="radiogroup" aria-label="Type">
                  {(
                    [
                      ["all", "All"],
                      ["Series", "Shows"],
                      ["Movie", "Movies"],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} role="radio" aria-checked={kind === v} className={kind === v ? "is-active" : ""} onClick={() => setKind(v)}>
                      {l}
                    </button>
                  ))}
                </div>
                <label className="vault__search">
                  <Icon name="search" size={16} />
                  <input className="input" type="search" placeholder="Search the Vault" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the Vault" />
                </label>
                <select className="select select--compact vault__sort" value={sort} onChange={(e) => setSort(e.target.value as VaultSort)} aria-label="Sort">
                  {SORTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {list.length === 0 ? (
              <p className="vault__none">
                {deferredQuery
                  ? `Nothing in the Vault matches “${deferredQuery}”.`
                  : filter === "missing"
                    ? "Nothing's missing. Everything you've had is still in your library."
                    : filter === "incomplete"
                      ? "Every show has all the episodes it ever had."
                      : filter === "restricted"
                        ? "Everyone who has the library can see every title in it."
                        : "Nothing here."}
              </p>
            ) : (
              <div className="vault__grid">
                {list.slice(0, shown).map((row) => (
                  <VaultCard
                    key={row.key}
                    row={row}
                    userId={userId}
                    admin={isAdmin}
                    users={users}
                    isNew={Boolean(row.entry.missing && row.entry.missing > visitedAt)}
                    showActions={showActions}
                  />
                ))}
              </div>
            )}
            {list.length > shown && (
              <div className="vault__more">
                <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE * 2)}>
                  Show more
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShown(list.length)}>
                  Show all {list.length.toLocaleString()}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="vault__foot">
          <div className="setting__text">
            <span className="setting__label">Keep a copy</span>
            <span className="setting__hint">A spreadsheet to read or re-download from, or a backup to load on another device or server.</span>
          </div>
          <div className="vault__foot-actions">
            <Button variant="secondary" size="sm" icon="download" disabled={empty} onClick={exportCsv}>
              Spreadsheet
            </Button>
            <Button variant="secondary" size="sm" icon="download" disabled={empty} onClick={exportJson}>
              Back up
            </Button>
            <Button variant="ghost" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
              Import
            </Button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="panel vault-admin">
          <header className="vault-admin__head">
            <span className="vault-admin__icon" aria-hidden="true">
              <Icon name="users" size={18} />
            </span>
            <div>
              <h3 className="vault-admin__title">Who can see what</h3>
              <p className="vault-admin__desc">
                For administrators. Set a title's audience from the lock on its card (or right-click any poster → Who can see this). Below, pick which libraries
                each person can open. Both are saved in Jellyfin, so every app follows them.
              </p>
            </div>
            {stats.restricted > 0 && (
              <button
                className="vault-admin__count"
                onClick={() => {
                  setFilter("restricted");
                  setQuery("");
                  sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <Icon name="lock" size={14} /> {plural(stats.restricted, "title")} restricted
              </button>
            )}
          </header>
          <LibraryAccess />
        </div>
      )}
    </SettingsSection>
  );
}
