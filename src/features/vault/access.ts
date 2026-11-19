// Who can see what (administrators): per-title visibility through Jellyfin's own blocked
// tags, and which libraries each user has. Both live on the server, so every Jellyfin app
// follows them.

import { client, getItemFull } from "@/api/jellyfin";
import type { BaseItem, User, UserPolicy, VirtualFolder } from "@/api/types";
import { hideTag, shortId, withVisibility } from "./logic";

/** Titles whose audience can be set: films and whole shows (a show's seasons and episodes follow it). */
export const canRestrict = (item: Pick<BaseItem, "Type">) => item.Type === "Movie" || item.Type === "Series";

export const getUsers = () => client().request<User[]>("/Users");
export const getLibraries = () => client().request<VirtualFolder[]>("/Library/VirtualFolders");

/**
 * Changes one user's policy. The server replaces the whole policy, so this starts from
 * what it holds now rather than a copy that another change may have overtaken.
 */
async function updatePolicy(userId: string, change: (policy: UserPolicy) => UserPolicy | null) {
  const fresh = await client().request<User>(`/Users/${userId}`);
  if (!fresh?.Policy) throw new Error("No policy");
  const next = change(fresh.Policy);
  if (next) await client().request<void>(`/Users/${userId}/Policy`, { method: "POST", body: next });
}

/** Users whose policy doesn't yet block their own hide tag get it added. */
async function ensureBlocked(users: User[]) {
  for (const u of users) {
    const tag = hideTag(u.Id);
    await updatePolicy(u.Id, (policy) => {
      const blocked = policy.BlockedTags ?? [];
      return blocked.some((t) => t.toLowerCase() === tag) ? null : { ...policy, BlockedTags: [...blocked, tag] };
    });
  }
}

/**
 * Sets who can see each title: hidden from `hideFrom` (users), or, with `owner`, from
 * everyone but its owner. Tags are locked against metadata refreshes so a "Replace all
 * metadata" can't drop them. Resolves to the titles that couldn't be changed.
 */
export async function applyVisibility(items: Pick<BaseItem, "Id">[], hideFrom: User[], owner?: string): Promise<string[]> {
  await ensureBlocked(hideFrom);
  const failed: string[] = [];
  for (const { Id } of items) {
    try {
      const full = await getItemFull(Id);
      const tags = withVisibility(full.Tags, hideFrom.map((u) => u.Id), owner);
      const restricted = hideFrom.length > 0;
      const locked = new Set((full as BaseItem & { LockedFields?: string[] }).LockedFields ?? []);
      if (restricted) locked.add("Tags");
      // Nothing left to protect: let refreshes manage tags again.
      else if (!tags.length) locked.delete("Tags");
      const { UserData: _userData, ...rest } = full as BaseItem & Record<string, unknown>;
      await client().request<void>(`/Items/${Id}`, { method: "POST", body: { ...rest, Tags: tags, LockedFields: [...locked] } });
    } catch {
      failed.push(Id);
    }
  }
  return failed;
}

/** Users by the short id titles are tagged with. */
export function usersByShortId(users: User[]): Map<string, User> {
  return new Map(users.map((u) => [shortId(u.Id), u]));
}

/** Which libraries a user sees: every one, or the ones listed. */
export async function setLibraryAccess(user: Pick<User, "Id">, access: { all: boolean; ids: string[] }) {
  await updatePolicy(user.Id, (policy) => ({ ...policy, EnableAllFolders: access.all, EnabledFolders: access.all ? [] : access.ids }));
}
