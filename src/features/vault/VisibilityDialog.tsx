import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client, getItemFull } from "@/api/jellyfin";
import type { BaseItem, User } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { Dialog, namesOf } from "@/features/manage/Dialog";
import { closeDialog } from "@/features/manage/store";
import { applyVisibility, getUsers } from "./access";
import { shortId, visibilityOf } from "./logic";
import { noteVisibility } from "./store";

type Mode = "everyone" | "private" | "custom";

export function UserAvatar({ user, size = 32 }: { user: Pick<User, "Id" | "Name" | "PrimaryImageTag">; size?: number }) {
  return user.PrimaryImageTag ? (
    <img className="avatar" style={{ width: size, height: size }} src={client().userImageUrl(user.Id, user.PrimaryImageTag, size * 2)} alt="" />
  ) : (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {user.Name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const useServerUsers = (enabled = true) => useQuery({ queryKey: ["vault", "users"], queryFn: getUsers, staleTime: 60_000, enabled });

/** Who can see a title (or a selection): everyone, only you, or the people you pick. */
export function VisibilityDialog({ items }: { items: BaseItem[] }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const users = useServerUsers();
  const current = useQuery({
    queryKey: ["vault", "visibility", items.map((i) => i.Id)],
    queryFn: () => Promise.all(items.map((i) => getItemFull(i.Id))),
    staleTime: 0,
  });
  const others = useMemo(
    () => (users.data ?? []).filter((u) => u.Id !== user?.Id).sort((a, b) => a.Name.localeCompare(b.Name)),
    [users.data, user?.Id],
  );
  const [mode, setMode] = useState<Mode | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mixed, setMixed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from how the title is set now (the first one's, for a selection that differs).
  useEffect(() => {
    if (!current.data || mode !== null) return;
    const all = current.data.map((i) => visibilityOf(i.Tags));
    const first = all[0] ?? { hiddenFrom: [] };
    setMixed(all.some((v) => JSON.stringify(v) !== JSON.stringify(first)));
    setMode(first.owner ? "private" : first.hiddenFrom.length ? "custom" : "everyone");
    setHidden(new Set(first.hiddenFrom));
  }, [current.data, mode]);

  const loading = users.isPending || current.isPending || mode === null;
  const hideFrom = mode === "everyone" ? [] : mode === "private" ? others : others.filter((u) => hidden.has(shortId(u.Id)));

  const toggle = (u: User) =>
    setHidden((prev) => {
      const next = new Set(prev);
      const id = shortId(u.Id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (!user || !mode) return;
    setBusy(true);
    setError(null);
    try {
      const owner = mode === "private" ? user.Id : undefined;
      const failed = await applyVisibility(items, hideFrom, owner);
      const done = items.filter((i) => !failed.includes(i.Id)).map((i) => i.Id);
      noteVisibility(
        user.Id,
        done,
        hideFrom.map((u) => shortId(u.Id)),
        owner ? shortId(owner) : undefined,
      );
      qc.invalidateQueries();
      if (failed.length === items.length) {
        setError("The server didn't save it. Check that you're signed in as an administrator.");
        return;
      }
      const what = namesOf(items);
      showToast(
        failed.length
          ? `Saved ${done.length} of ${items.length}`
          : mode === "everyone"
            ? `Everyone can see ${what}`
            : mode === "private"
              ? `Only you can see ${what}`
              : `${what} is hidden from ${hideFrom.length === 1 ? hideFrom[0].Name : `${hideFrom.length} people`}`,
      );
      closeDialog();
    } catch {
      setError("Couldn't update the users' access. Check that you're signed in as an administrator.");
    } finally {
      setBusy(false);
    }
  };

  const options: { value: Mode; label: string; hint: string }[] = [
    { value: "everyone", label: "Everyone", hint: "Every user on the server who has the library" },
    { value: "private", label: "Only me", hint: "Hidden from everyone else, including people added later" },
    { value: "custom", label: "Choose who", hint: "Hide it from the people you pick" },
  ];

  return (
    <Dialog
      title="Who can see this"
      subtitle={namesOf(items)}
      busy={busy}
      footer={
        <>
          <span className="mdialog__foot-note">{mode === "custom" && !loading ? `${others.length - hideFrom.length} of ${others.length} can see it` : ""}</span>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="lock" onClick={save} disabled={busy || loading || (mode === "custom" && !others.length)}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="visdialog__loading">
          <Spinner />
        </div>
      ) : users.isError ? (
        <p className="mdialog__error">Couldn't load the server's users. Only administrators can change who sees what.</p>
      ) : (
        <>
          {mixed && (
            <p className="mdialog__note">
              These titles are set differently. Saving gives all {items.length} the setting below.
            </p>
          )}
          <div className="mdialog__options" role="radiogroup" aria-label="Who can see it">
            {options.map((o) => (
              <button key={o.value} role="radio" aria-checked={mode === o.value} className={`mdialog__option ${mode === o.value ? "is-on" : ""}`} onClick={() => setMode(o.value)}>
                <span className="mdialog__radio" aria-hidden="true" />
                <span>
                  <span className="mdialog__option-label">{o.label}</span>
                  <span className="mdialog__option-hint">{o.hint}</span>
                </span>
              </button>
            ))}
          </div>
          {mode === "custom" && (
            <ul className="visdialog__users" aria-label="Users">
              {others.length === 0 && <li className="muted">You're the only user on this server.</li>}
              {others.map((u) => {
                const can = !hidden.has(shortId(u.Id));
                const note = [u.Policy?.IsAdministrator && "Administrator", u.Policy?.IsDisabled && "Disabled"].filter(Boolean).join(" · ");
                return (
                  <li key={u.Id} className={`visdialog__user ${can ? "" : "is-hidden"}`}>
                    <UserAvatar user={u} size={34} />
                    <span className="visdialog__user-text">
                      <span className="visdialog__user-name">{u.Name}</span>
                      <span className="visdialog__user-note">{can ? "Can see it" : "Hidden"}{note ? ` · ${note}` : ""}</span>
                    </span>
                    <button className="switch" role="switch" aria-checked={can} aria-label={`${u.Name} can see it`} onClick={() => toggle(u)} />
                  </li>
                );
              })}
            </ul>
          )}
          <p className="visdialog__how">
            <Icon name="info" size={16} />
            <span>
              Uses Jellyfin's parental controls, so it applies in every Jellyfin app. A show's seasons and episodes are hidden with it, and you can always see it
              yourself.
            </span>
          </p>
          {error && <p className="mdialog__error">{error}</p>}
        </>
      )}
    </Dialog>
  );
}
