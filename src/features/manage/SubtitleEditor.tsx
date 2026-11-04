import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItemFull } from "@/api/jellyfin";
import { LANGUAGES } from "@/api/languages";
import { deleteSubtitle, downloadRemoteSubtitle, searchRemoteSubtitles, uploadSubtitle, type RemoteSubtitle } from "@/api/manage";
import type { BaseItem } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { Dialog } from "./Dialog";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function SubtitleEditor({ item }: { item: BaseItem }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const preferred = user?.Configuration?.SubtitleLanguagePreference;
  const [language, setLanguage] = useState(preferred && LANGUAGES.some(([c]) => c === preferred) ? preferred : "eng");
  const [query, setQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState({ forced: false, hearingImpaired: false });
  const file = useRef<HTMLInputElement>(null);

  const full = useQuery({ queryKey: ["item", item.Id], queryFn: () => getItemFull(item.Id), staleTime: 0 });
  const results = useQuery({
    queryKey: ["manage", "subtitle-search", item.Id, query],
    queryFn: () => searchRemoteSubtitles(item.Id, query!),
    enabled: query !== null,
    staleTime: 5 * 60_000,
  });
  const streams = (full.data?.MediaSources?.[0]?.MediaStreams ?? full.data?.MediaStreams ?? []).filter((s) => s.Type === "Subtitle");

  const attempt = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await full.refetch();
      qc.invalidateQueries({ queryKey: ["item", item.Id] });
      showToast(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const flags = (s: RemoteSubtitle) =>
    [s.IsHashMatch && "Exact match", s.Forced && "Forced", s.HearingImpaired && "SDH", (s.MachineTranslated || s.AiTranslated) && "Machine translated"].filter(Boolean) as string[];

  return (
    <Dialog title="Edit subtitles" subtitle={item.SeriesName ? `${item.SeriesName} · ${item.Name}` : item.Name} wide busy={busy}>
      <section className="msub">
        <h3 className="msub__heading">On this file</h3>
        {full.isPending ? (
          <Spinner />
        ) : streams.length ? (
          <ul className="msub__list">
            {streams.map((s) => (
              <li key={s.Index} className="msub__row">
                <span className="msub__name">{s.DisplayTitle || s.Language || `Track ${s.Index}`}</span>
                <span className="msub__tags">
                  {s.Codec && <span className="badge">{s.Codec.toUpperCase()}</span>}
                  {s.IsExternal ? <span className="badge">External</span> : <span className="badge">Embedded</span>}
                  {s.IsForced && <span className="badge">Forced</span>}
                </span>
                {s.IsExternal ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    onClick={() => attempt(() => deleteSubtitle(item.Id, s.Index), "Subtitle deleted")}
                    aria-label={`Delete ${s.DisplayTitle ?? "subtitle"}`}
                  >
                    Delete
                  </Button>
                ) : (
                  <span className="msub__locked" title="Embedded subtitles are part of the video file">
                    In the video
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No subtitles yet.</p>
        )}
      </section>

      <section className="msub">
        <h3 className="msub__heading">Find online</h3>
        <form
          className="msub__search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(language);
          }}
        >
          <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" icon="search" disabled={busy}>
            Search
          </Button>
        </form>
        {query !== null &&
          (results.isPending ? (
            <Spinner label="Searching providers" />
          ) : results.isError ? (
            <p className="mdialog__error">{errorText(results.error)}. Subtitle providers are set up in the server dashboard.</p>
          ) : results.data?.length ? (
            <ul className="msub__list msub__results">
              {results.data.map((s) => (
                <li key={s.Id} className="msub__row">
                  <span className="msub__name">
                    {s.Name || s.Id}
                    <span className="msub__detail">
                      {[s.ProviderName, s.Format?.toUpperCase(), s.DownloadCount ? `${s.DownloadCount.toLocaleString()} downloads` : "", s.CommunityRating ? `★ ${s.CommunityRating.toFixed(1)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="msub__tags">
                    {flags(s).map((f) => (
                      <span className="badge" key={f}>
                        {f}
                      </span>
                    ))}
                  </span>
                  <Button variant="secondary" size="sm" icon="download" disabled={busy} onClick={() => attempt(() => downloadRemoteSubtitle(item.Id, s.Id), "Subtitle downloaded")}>
                    Get
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No subtitles found in that language.</p>
          ))}
      </section>

      <section className="msub">
        <h3 className="msub__heading">Upload a file</h3>
        <div className="msub__upload">
          <label className="check">
            <input type="checkbox" checked={upload.forced} onChange={(e) => setUpload((u) => ({ ...u, forced: e.target.checked }))} />
            Forced
          </label>
          <label className="check">
            <input type="checkbox" checked={upload.hearingImpaired} onChange={(e) => setUpload((u) => ({ ...u, hearingImpaired: e.target.checked }))} />
            For the hearing impaired
          </label>
          <Button variant="secondary" icon="upload" disabled={busy} onClick={() => file.current?.click()}>
            Choose file
          </Button>
          <input
            ref={file}
            type="file"
            accept=".srt,.vtt,.ass,.ssa,.sub"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) attempt(() => uploadSubtitle(item.Id, f, { language, ...upload }), "Subtitle uploaded");
            }}
          />
        </div>
        <p className="mdialog__note">Uploads use the language selected above.</p>
      </section>
      {error && <p className="mdialog__error">{error}</p>}
    </Dialog>
  );
}
