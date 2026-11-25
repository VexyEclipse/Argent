// "Editions" for a show: name its editions, make a folder an edition Argent didn't
// recognise, or say one isn't. See "editions" in api/duplicates.ts.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { editionName, editionsOf, foldersOf, type EditionSettings, type EpisodeFolder } from "@/api/duplicates";
import { saveEditionSettings, useEditionSettings } from "@/api/editionSettings";
import { getEpisodes, getLibraryRoots, getSeasons } from "@/api/jellyfin";
import type { BaseItem } from "@/api/types";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { Dialog } from "@/features/manage/Dialog";
import { closeDialog } from "@/features/manage/store";

/** A file's folder's own name, and where that folder is ("…\Show\Original"). */
const nameOf = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? path;
function whereOf(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  return `…${sep}${path.split(/[\\/]/).slice(-3, -1).join(sep)}`;
}

export function EditionsDialog({ series }: { series: BaseItem }) {
  const qc = useQueryClient();
  const saved = useEditionSettings(series.Id);
  const [draft, setDraft] = useState<EditionSettings>(saved);
  const seasons = useQuery({ queryKey: ["seasons", series.Id], queryFn: () => getSeasons(series.Id).then((r) => r.Items), staleTime: 60_000 });
  // The folders as your saved corrections leave them, and which hold copies.
  const data = useQuery({
    queryKey: ["episodes", series.Id, "folders", JSON.stringify(saved)],
    queryFn: async () => {
      const [episodes, roots] = await Promise.all([getEpisodes(series.Id).then((r) => r.Items), getLibraryRoots()]);
      return { folders: foldersOf(episodes, roots), editions: new Set(editionsOf(episodes, roots).map((e) => e.folder)) };
    },
    staleTime: 30_000,
  });

  const added = draft.added ?? {};
  const removed = draft.removed ?? [];
  const isEdition = (f: string) => f in added || (Boolean(data.data?.editions.has(f)) && !removed.includes(f));
  const setEdition = (f: string, on: boolean) =>
    setDraft((d) => {
      const nextAdded = { ...(d.added ?? {}) };
      let nextRemoved = (d.removed ?? []).filter((x) => x !== f);
      if (on) {
        if (!data.data?.editions.has(f) && !(f in nextAdded)) nextAdded[f] = null;
      } else {
        delete nextAdded[f];
        nextRemoved = [...nextRemoved, f];
      }
      return { ...d, added: nextAdded, removed: nextRemoved };
    });
  const setName = (f: string, name: string) => setDraft((d) => ({ ...d, names: { ...(d.names ?? {}), [f]: name } }));
  const setSeason = (f: string, season: number | null) =>
    setDraft((d) => ({ ...d, added: { ...(d.added ?? {}), [f]: season }, removed: (d.removed ?? []).filter((x) => x !== f) }));

  const save = () => {
    const names = Object.fromEntries(Object.entries(draft.names ?? {}).flatMap(([f, n]) => (n.trim() ? [[f, n.trim()]] : [])));
    saveEditionSettings(series.Id, { names, added: draft.added ?? {}, removed: [...new Set(removed)] });
    for (const key of [["episodes", series.Id], ["nextup", series.Id], ["play"]]) qc.invalidateQueries({ queryKey: key });
    closeDialog();
    showToast("Editions saved");
  };

  const numbered = (seasons.data ?? []).filter((s) => (s.IndexNumber ?? 0) > 0);
  const seasonName = (id?: string) => seasons.data?.find((s) => s.Id === id)?.Name;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <Dialog
      title="Editions"
      subtitle={series.Name}
      wide
      footer={
        <>
          <Button variant="ghost" className="editions__reset" onClick={() => setDraft({})} disabled={!Object.keys(draft).length}>
            Reset to automatic
          </Button>
          <Button variant="secondary" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!changed}>
            Save
          </Button>
        </>
      }
    >
      <p className="mdialog__note">
        An edition is a folder holding another copy of the show&apos;s episodes, such as a Blu-ray beside the first release. Episodes are copies of each other
        when they have the same season and episode number. Editions are listed under Edition on the show page and in the player&apos;s Version menu. Changes are
        kept for your account.
      </p>
      {data.isPending ? (
        <Spinner />
      ) : (
        <ul className="editions">
          {(data.data?.folders ?? []).map((f) => (
            <FolderRow
              key={f.folder}
              folder={f}
              on={isEdition(f.folder)}
              season={seasonName(f.seasonId)}
              name={draft.names?.[f.folder] ?? ""}
              copiesOf={f.folder in added ? added[f.folder] : undefined}
              numbered={numbered}
              onEdition={(on) => setEdition(f.folder, on)}
              onName={(n) => setName(f.folder, n)}
              onSeason={(s) => setSeason(f.folder, s)}
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function FolderRow(p: {
  folder: EpisodeFolder;
  on: boolean;
  season?: string;
  name: string;
  /** For a folder you made an edition: the season its episodes are copies of (null: as numbered). */
  copiesOf: number | null | undefined;
  numbered: BaseItem[];
  onEdition: (on: boolean) => void;
  onName: (name: string) => void;
  onSeason: (season: number | null) => void;
}) {
  const { folder: f } = p;
  const facts = [
    `${f.episodes} ${f.episodes === 1 ? "episode" : "episodes"}`,
    f.copied ? `${f.copied} with a copy elsewhere` : "no copies elsewhere",
    p.season && `Jellyfin: ${p.season}`,
  ];
  return (
    <li className={`editions__row ${p.on ? "is-on" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={p.on} onChange={(e) => p.onEdition(e.target.checked)} />
        <span>
          <span className="editions__folder">{nameOf(f.path)}</span>
          <span className="check__hint">
            {facts.filter(Boolean).join(" · ")}
            <br />
            {whereOf(f.path)}
          </span>
        </span>
      </label>
      {p.on && (
        <div className="editions__fields">
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input" value={p.name} placeholder={editionName(f.path)} onChange={(e) => p.onName(e.target.value)} maxLength={60} />
          </label>
          <label className="field">
            <span className="field__label">Copies of</span>
            <select
              className="select"
              value={p.copiesOf === undefined || p.copiesOf === null ? "" : String(p.copiesOf)}
              onChange={(e) => p.onSeason(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">The episodes as numbered</option>
              {p.numbered.map((s) => (
                <option key={s.Id} value={s.IndexNumber}>
                  {s.Name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </li>
  );
}
