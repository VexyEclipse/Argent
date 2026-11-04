import { useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItemFull } from "@/api/jellyfin";
import { getMetadataEditorInfo, updateItemMetadata } from "@/api/manage";
import type { BaseItem } from "@/api/types";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { Dialog } from "./Dialog";
import { closeDialog } from "./store";

type Full = BaseItem & Record<string, unknown>;

interface Form {
  Name: string;
  OriginalTitle: string;
  ForcedSortName: string;
  Overview: string;
  Tagline: string;
  ProductionYear: string;
  PremiereDate: string;
  EndDate: string;
  Status: string;
  OfficialRating: string;
  CommunityRating: string;
  CriticRating: string;
  IndexNumber: string;
  ParentIndexNumber: string;
  Genres: string[];
  Tags: string[];
  Studios: string[];
  Imdb: string;
  Tmdb: string;
  Tvdb: string;
  LockData: boolean;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");

export function toForm(item: Full): Form {
  const ids = item.ProviderIds ?? {};
  return {
    Name: item.Name ?? "",
    OriginalTitle: str(item.OriginalTitle),
    ForcedSortName: str(item.ForcedSortName),
    Overview: str(item.Overview),
    Tagline: item.Taglines?.[0] ?? "",
    ProductionYear: str(item.ProductionYear),
    PremiereDate: day(item.PremiereDate),
    EndDate: day(item.EndDate),
    Status: str(item.Status),
    OfficialRating: str(item.OfficialRating),
    CommunityRating: str(item.CommunityRating),
    CriticRating: str(item.CriticRating),
    IndexNumber: str(item.IndexNumber),
    ParentIndexNumber: str(item.ParentIndexNumber),
    Genres: item.Genres ?? [],
    Tags: item.Tags ?? [],
    Studios: (item.Studios ?? []).map((s) => s.Name),
    Imdb: ids.Imdb ?? "",
    Tmdb: ids.Tmdb ?? "",
    Tvdb: ids.Tvdb ?? "",
    LockData: Boolean(item.LockData),
  };
}

const num = (v: string, int = false) => {
  if (!v.trim()) return null;
  const n = int ? parseInt(v, 10) : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const isoDay = (v: string) => (v ? new Date(`${v}T00:00:00Z`).toISOString() : null);

/** Only the fields that changed, in the shape the server stores. */
export function changesOf(item: Full, before: Form, after: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const changed = (k: keyof Form) => JSON.stringify(before[k]) !== JSON.stringify(after[k]);
  if (changed("Name")) out.Name = after.Name.trim();
  if (changed("OriginalTitle")) out.OriginalTitle = after.OriginalTitle.trim() || null;
  if (changed("ForcedSortName")) out.ForcedSortName = after.ForcedSortName.trim() || null;
  if (changed("Overview")) out.Overview = after.Overview;
  if (changed("Tagline")) out.Taglines = after.Tagline.trim() ? [after.Tagline.trim(), ...(item.Taglines ?? []).slice(1)] : (item.Taglines ?? []).slice(1);
  if (changed("ProductionYear")) out.ProductionYear = num(after.ProductionYear, true);
  if (changed("PremiereDate")) out.PremiereDate = isoDay(after.PremiereDate);
  if (changed("EndDate")) out.EndDate = isoDay(after.EndDate);
  if (changed("Status")) out.Status = after.Status || null;
  if (changed("OfficialRating")) out.OfficialRating = after.OfficialRating || null;
  if (changed("CommunityRating")) out.CommunityRating = num(after.CommunityRating);
  if (changed("CriticRating")) out.CriticRating = num(after.CriticRating);
  if (changed("IndexNumber")) out.IndexNumber = num(after.IndexNumber, true);
  if (changed("ParentIndexNumber")) out.ParentIndexNumber = num(after.ParentIndexNumber, true);
  if (changed("Genres")) out.Genres = after.Genres;
  if (changed("Tags")) out.Tags = after.Tags;
  if (changed("Studios")) {
    // Keep the ids of studios that stay.
    const known = new Map((item.Studios ?? []).map((s) => [s.Name, s]));
    out.Studios = after.Studios.map((name) => known.get(name) ?? { Name: name });
  }
  if (changed("Imdb") || changed("Tmdb") || changed("Tvdb")) {
    // Other providers' ids are kept as they are.
    const ids: Record<string, string> = { ...(item.ProviderIds ?? {}) };
    for (const k of ["Imdb", "Tmdb", "Tvdb"] as const) {
      const v = after[k].trim();
      if (v) ids[k] = v;
      else delete ids[k];
    }
    out.ProviderIds = ids;
  }
  if (changed("LockData")) out.LockData = after.LockData;
  return out;
}

function ChipInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !values.includes(s));
    if (parts.length) onChange([...values, ...parts]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  };
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="chips-input">
        {values.map((v) => (
          <span className="chips-input__chip" key={v}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={values.length ? "" : "Type and press Enter"} aria-label={label} />
      </div>
    </div>
  );
}

export function MetadataEditor({ item }: { item: BaseItem }) {
  const full = useQuery({ queryKey: ["item", item.Id], queryFn: () => getItemFull(item.Id), staleTime: 0 });
  const info = useQuery({ queryKey: ["manage", "editor-info", item.Id], queryFn: () => getMetadataEditorInfo(item.Id), staleTime: 10 * 60_000 });
  if (full.isPending) {
    return (
      <Dialog title="Edit metadata" subtitle={item.Name} wide>
        <Spinner />
      </Dialog>
    );
  }
  if (full.isError) {
    return (
      <Dialog title="Edit metadata" subtitle={item.Name} wide>
        <p className="mdialog__error">{full.error instanceof Error ? full.error.message : "Couldn't load this item."}</p>
      </Dialog>
    );
  }
  return <MetadataForm item={full.data as Full} ratings={info.data?.ParentalRatingOptions?.map((r) => r.Name) ?? []} />;
}

function MetadataForm({ item: loaded, ratings }: { item: Full; ratings: string[] }) {
  const qc = useQueryClient();
  // Edits are measured against the item as it was when the editor opened, even if the
  // cache refreshes underneath.
  const [item] = useState(loaded);
  const [initial] = useState(() => toForm(loaded));
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const changes = changesOf(item, initial, form);
  const dirty = Object.keys(changes).length > 0;
  const isSeries = item.Type === "Series";
  const isEpisode = item.Type === "Episode";
  const ratingOptions = form.OfficialRating && !ratings.includes(form.OfficialRating) ? [form.OfficialRating, ...ratings] : ratings;

  const save = async () => {
    if (!form.Name.trim()) {
      setError("A title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateItemMetadata(item.Id, changes);
      await qc.invalidateQueries();
      showToast("Metadata saved");
      closeDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setBusy(false);
    }
  };

  const text = (k: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </label>
  );

  return (
    <Dialog
      title="Edit metadata"
      subtitle={item.SeriesName ? `${item.SeriesName} · ${item.Name}` : item.Name}
      wide
      busy={busy}
      footer={
        <>
          <span className="mdialog__foot-note">{dirty ? "Unsaved changes" : "No changes"}</span>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={save} disabled={!dirty || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="meta-form">
        <div className="meta-form__grid">
          {text("Name", "Title", { required: true, maxLength: 300 })}
          {text("OriginalTitle", "Original title", { maxLength: 300 })}
          {text("ForcedSortName", "Sort title", { placeholder: "Same as title", maxLength: 300 })}
          {isEpisode ? (
            <div className="meta-form__pair">
              {text("ParentIndexNumber", "Season", { inputMode: "numeric", pattern: "[0-9]*" })}
              {text("IndexNumber", "Episode", { inputMode: "numeric", pattern: "[0-9]*" })}
            </div>
          ) : (
            text("Tagline", "Tagline", { maxLength: 300 })
          )}
        </div>
        <label className="field">
          <span className="field__label">Overview</span>
          <textarea className="input meta-form__overview" value={form.Overview} onChange={(e) => set("Overview", e.target.value)} rows={5} />
        </label>
        <div className="meta-form__grid meta-form__grid--4">
          {text("ProductionYear", "Year", { inputMode: "numeric", pattern: "[0-9]*", maxLength: 4 })}
          {text("PremiereDate", isEpisode ? "Air date" : "Release date", { type: "date" })}
          {isSeries && text("EndDate", "End date", { type: "date" })}
          {isSeries && (
            <label className="field">
              <span className="field__label">Status</span>
              <select className="select" value={form.Status} onChange={(e) => set("Status", e.target.value)}>
                <option value="">Unknown</option>
                <option value="Continuing">Continuing</option>
                <option value="Ended">Ended</option>
                <option value="Unreleased">Unreleased</option>
              </select>
            </label>
          )}
          <label className="field">
            <span className="field__label">Parental rating</span>
            <select className="select" value={form.OfficialRating} onChange={(e) => set("OfficialRating", e.target.value)}>
              <option value="">None</option>
              {ratingOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {text("CommunityRating", "Community rating", { inputMode: "decimal", placeholder: "0–10" })}
          {text("CriticRating", "Critic rating", { inputMode: "decimal", placeholder: "0–100" })}
        </div>
        <div className="meta-form__grid">
          <ChipInput label="Genres" values={form.Genres} onChange={(v) => set("Genres", v)} />
          <ChipInput label="Studios" values={form.Studios} onChange={(v) => set("Studios", v)} />
          <ChipInput label="Tags" values={form.Tags} onChange={(v) => set("Tags", v)} />
        </div>
        <div className="meta-form__grid meta-form__grid--3">
          {text("Imdb", "IMDb id", { placeholder: "tt0000000", spellCheck: false })}
          {text("Tmdb", "TMDb id", { spellCheck: false })}
          {text("Tvdb", "TVDB id", { spellCheck: false })}
        </div>
        <label className="check meta-form__lock">
          <input type="checkbox" checked={form.LockData} onChange={(e) => set("LockData", e.target.checked)} />
          <span>
            Lock this item
            <span className="field__hint">Refreshes won't change its metadata</span>
          </span>
        </label>
        <p className="mdialog__note">Cast and crew, and anything not shown here, are kept as they are.</p>
      </div>
      {error && <p className="mdialog__error">{error}</p>}
    </Dialog>
  );
}
