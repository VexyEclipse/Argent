import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItemFull } from "@/api/jellyfin";
import { applyMatch, searchForMatch, updateItemMetadata, type RemoteSearchResult } from "@/api/manage";
import type { BaseItem } from "@/api/types";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { Dialog } from "./Dialog";
import { closeDialog } from "./store";

/** Which ids each type can be searched by, in the order Jellyfin's providers prefer. */
const ID_FIELDS: Record<string, [string, string, string][]> = {
  Movie: [
    ["Imdb", "IMDb id", "tt0000000"],
    ["Tmdb", "TMDb id", ""],
  ],
  Series: [
    ["Tvdb", "TVDB id", ""],
    ["Tmdb", "TMDb id", ""],
    ["Imdb", "IMDb id", "tt0000000"],
  ],
  BoxSet: [["Tmdb", "TMDb collection id", ""]],
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const yearOf = (r: RemoteSearchResult) => r.ProductionYear ?? (r.PremiereDate ? new Date(r.PremiereDate).getFullYear() : undefined);

/**
 * Fixes a wrong match: search the metadata providers for the right title and apply it.
 * The item's metadata (and optionally images) is then replaced with the chosen title's.
 */
export function IdentifyDialog({ item }: { item: BaseItem }) {
  const qc = useQueryClient();
  const fields = ID_FIELDS[item.Type] ?? [];
  // A locked item ignores online metadata, so a match would never land: check first.
  const full = useQuery({ queryKey: ["item", item.Id], queryFn: () => getItemFull(item.Id), staleTime: 0 });
  const locked = Boolean((full.data as (BaseItem & { LockData?: boolean }) | undefined)?.LockData);
  const [name, setName] = useState(item.Name);
  const [year, setYear] = useState(item.ProductionYear ? String(item.ProductionYear) : "");
  // Ids start empty on purpose: the current ones are what point at the wrong title.
  const [ids, setIds] = useState<Record<string, string>>({});
  const [results, setResults] = useState<RemoteSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<RemoteSearchResult | null>(null);
  const [replaceImages, setReplaceImages] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSearch = name.trim().length > 0 || Object.values(ids).some((v) => v.trim());

  const search = async () => {
    if (!canSearch) return;
    setSearching(true);
    setError(null);
    setChosen(null);
    try {
      setResults(await searchForMatch(item, { name, year: year ? parseInt(year, 10) : undefined, providerIds: ids }));
    } catch (e) {
      setError(errorText(e));
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const apply = async () => {
    if (!chosen) return;
    setApplying(true);
    setError(null);
    try {
      if (locked) await updateItemMetadata(item.Id, { LockData: false });
      await applyMatch(item.Id, chosen, replaceImages);
      showToast(`Updating to ${chosen.Name}. This can take a moment.`);
      // The server refreshes in the background: pick up the result as it lands.
      qc.invalidateQueries();
      window.setTimeout(() => qc.invalidateQueries(), 4000);
      window.setTimeout(() => qc.invalidateQueries(), 15000);
      closeDialog();
    } catch (e) {
      setError(errorText(e));
      setApplying(false);
    }
  };

  const currentIds = Object.entries(full.data?.ProviderIds ?? item.ProviderIds ?? {})
    .filter(([k]) => fields.some(([f]) => f === k))
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

  return (
    <Dialog
      title="Identify"
      subtitle={item.Name}
      wide
      busy={applying}
      footer={
        chosen ? (
          <>
            <label className="check mident__images">
              <input type="checkbox" checked={replaceImages} onChange={(e) => setReplaceImages(e.target.checked)} />
              Replace existing images
            </label>
            <Button variant="secondary" onClick={() => setChosen(null)} disabled={applying}>
              Back
            </Button>
            <Button variant="primary" icon="check" onClick={apply} disabled={applying}>
              {applying ? "Applying…" : "Use this match"}
            </Button>
          </>
        ) : undefined
      }
    >
      {chosen ? (
        <div className="mident__confirm">
          <MatchCard result={chosen} />
          <p className="mdialog__warn">
            <Icon name="info" size={18} />
            {item.Name}'s title, overview, cast and other metadata will be replaced with {chosen.Name}'s
            {replaceImages ? ", and its artwork too" : ""}.{locked ? " The item is locked, so it's unlocked first; otherwise the new details wouldn't be saved." : ""}
          </p>
        </div>
      ) : (
        <>
          <p className="mdialog__note mident__intro">
            Search for the right title by name and year, or paste an id from IMDb, TMDb or TVDB for an exact match.
            {currentIds && ` Currently matched to ${currentIds}.`}
          </p>
          <form
            className="mident__form"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <label className="field mident__name">
              <span className="field__label">Title</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={300} />
            </label>
            <label className="field mident__year">
              <span className="field__label">Year</span>
              <input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="Any" />
            </label>
            {fields.map(([key, label, placeholder]) => (
              <label className="field" key={key}>
                <span className="field__label">{label}</span>
                <input
                  className="input"
                  value={ids[key] ?? ""}
                  onChange={(e) => setIds((v) => ({ ...v, [key]: e.target.value }))}
                  placeholder={placeholder || "Optional"}
                  spellCheck={false}
                  maxLength={40}
                />
              </label>
            ))}
            <Button type="submit" variant="primary" icon="search" disabled={!canSearch || searching} className="mident__go">
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>

          {searching ? (
            <Spinner label="Searching providers" />
          ) : results === null ? null : results.length ? (
            <ul className="mident__results">
              {results.map((r, i) => (
                <li key={`${r.SearchProviderName}-${r.Name}-${i}`}>
                  <button className="mident__result" onClick={() => setChosen(r)}>
                    <MatchCard result={r} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted mdialog__empty">No matches. Try a different spelling, drop the year, or search by id.</p>
          )}
        </>
      )}
      {error && <p className="mdialog__error">{error}</p>}
    </Dialog>
  );
}

function MatchCard({ result }: { result: RemoteSearchResult }) {
  const year = yearOf(result);
  const ids = Object.entries(result.ProviderIds ?? {})
    .filter(([, v]) => v)
    .slice(0, 3);
  return (
    <span className="mident__card">
      <span className="mident__poster">
        {result.ImageUrl ? <img src={result.ImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="film" size={20} />}
      </span>
      <span className="mident__text">
        <span className="mident__title">
          {result.Name}
          {year ? <span className="mident__year-tag"> ({year})</span> : null}
        </span>
        <span className="mident__meta">
          {[result.SearchProviderName, ...ids.map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(" · ")}
        </span>
        {result.Overview && <span className="mident__overview">{result.Overview}</span>}
      </span>
    </span>
  );
}
