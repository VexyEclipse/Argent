import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { getLibraries, setLibraryAccess } from "./access";
import { UserAvatar, useServerUsers } from "./VisibilityDialog";

interface Access {
  all: boolean;
  ids: string[];
}

const norm = (id: string) => id.replace(/-/g, "").toLowerCase();

function accessOf(u: User): Access {
  return { all: u.Policy?.EnableAllFolders !== false, ids: (u.Policy?.EnabledFolders ?? []).map(norm) };
}

/** Users × libraries: which libraries each person on the server can open. */
export function LibraryAccess() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const users = useServerUsers();
  const libraries = useQuery({ queryKey: ["vault", "libraries"], queryFn: getLibraries, staleTime: 5 * 60_000 });
  // Shown at once while the server saves; dropped once it has the new policy.
  const [pending, setPending] = useState<Record<string, Access>>({});

  if (users.isPending || libraries.isPending) {
    return (
      <div className="vaccess__loading">
        <Spinner />
      </div>
    );
  }
  if (users.isError || libraries.isError) return <p className="setting__note">Couldn't load the server's users and libraries.</p>;

  const libs = [...(libraries.data ?? [])].sort((a, b) => a.Name.localeCompare(b.Name));
  const people = (users.data ?? []).filter((u) => u.Id !== me?.Id).sort((a, b) => a.Name.localeCompare(b.Name));
  if (!people.length) return <p className="setting__note">You're the only user on this server. People you add in Jellyfin appear here.</p>;
  const allIds = libs.map((l) => norm(l.ItemId));

  const save = async (u: User, next: Access) => {
    setPending((p) => ({ ...p, [u.Id]: next }));
    try {
      await setLibraryAccess(u, next);
      await qc.invalidateQueries({ queryKey: ["vault", "users"] });
    } catch {
      showToast(`Couldn't change ${u.Name}'s libraries`);
    } finally {
      setPending((p) => {
        const rest = { ...p };
        delete rest[u.Id];
        return rest;
      });
    }
  };

  const toggleAll = (u: User, a: Access) => save(u, a.all ? { all: false, ids: allIds } : { all: true, ids: [] });
  const toggleLib = (u: User, a: Access, id: string) => {
    const has = a.all || a.ids.includes(id);
    const ids = a.all ? allIds.filter((x) => x !== id) : has ? a.ids.filter((x) => x !== id) : [...a.ids, id];
    save(u, { all: false, ids });
  };

  return (
    <div className="vaccess" role="region" aria-label="Library access">
      <div className="vaccess__scroll">
        <table className="vaccess__table">
          <thead>
            <tr>
              <th scope="col" className="vaccess__corner">
                Person
              </th>
              <th scope="col" className="vaccess__head">
                All
              </th>
              {libs.map((l) => (
                <th scope="col" key={l.ItemId} className="vaccess__head" title={l.Name}>
                  {l.Name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((u) => {
              const a = pending[u.Id] ?? accessOf(u);
              const saving = Boolean(pending[u.Id]);
              const count = a.all ? libs.length : a.ids.filter((id) => allIds.includes(id)).length;
              return (
                <tr key={u.Id} className={`${saving ? "is-saving" : ""} ${u.Policy?.IsDisabled ? "is-disabled" : ""}`}>
                  <th scope="row" className="vaccess__user">
                    <span className="vaccess__user-inner">
                      <UserAvatar user={u} size={30} />
                      <span className="vaccess__user-text">
                        <span className="vaccess__name">{u.Name}</span>
                        <span className="vaccess__sub">
                          {u.Policy?.IsDisabled ? "Disabled · " : u.Policy?.IsAdministrator ? "Admin · " : ""}
                          {a.all ? "Every library" : count === 0 ? "No libraries" : `${count} of ${libs.length}`}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td>
                    <button
                      className={`vaccess__cell vaccess__cell--all ${a.all ? "is-on" : ""}`}
                      role="checkbox"
                      aria-checked={a.all}
                      aria-label={`${u.Name}: every library, including new ones`}
                      title="Every library, including ones added later"
                      disabled={saving}
                      onClick={() => toggleAll(u, a)}
                    >
                      {a.all && <Icon name="checkAll" size={15} />}
                    </button>
                  </td>
                  {libs.map((l) => {
                    const id = norm(l.ItemId);
                    const on = a.all || a.ids.includes(id);
                    return (
                      <td key={l.ItemId}>
                        <button
                          className={`vaccess__cell ${on ? "is-on" : ""} ${a.all ? "is-implied" : ""}`}
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`${u.Name}: ${l.Name}`}
                          disabled={saving}
                          onClick={() => toggleLib(u, a, id)}
                        >
                          {on && <Icon name="check" size={14} />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
