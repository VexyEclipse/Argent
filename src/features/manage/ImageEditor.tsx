import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/api/jellyfin";
import { deleteItemImage, downloadRemoteImage, getItemImages, getRemoteImages, uploadItemImage, type RemoteImage } from "@/api/manage";
import type { BaseItem, ImageType } from "@/api/types";
import { Button } from "@/components/Button";
import { Spinner } from "@/components/States";
import { showToast } from "@/components/Toast";
import { Dialog } from "./Dialog";

const TYPES: { type: string; label: string; wide: boolean }[] = [
  { type: "Primary", label: "Poster", wide: false },
  { type: "Backdrop", label: "Backdrops", wide: true },
  { type: "Logo", label: "Logo", wide: true },
  { type: "Thumb", label: "Thumbnail", wide: true },
  { type: "Banner", label: "Banner", wide: true },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function ImageEditor({ item }: { item: BaseItem }) {
  const qc = useQueryClient();
  const types = item.Type === "Episode" ? TYPES.filter((t) => t.type === "Primary").map((t) => ({ ...t, label: "Still", wide: true })) : TYPES;
  const [type, setType] = useState(types[0].type);
  const [searching, setSearching] = useState(false);
  const [allLanguages, setAllLanguages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const meta = types.find((t) => t.type === type)!;

  const images = useQuery({ queryKey: ["manage", "images", item.Id], queryFn: () => getItemImages(item.Id), staleTime: 0 });
  const remote = useQuery({
    queryKey: ["manage", "remote-images", item.Id, type, allLanguages],
    queryFn: () => getRemoteImages(item.Id, type, allLanguages),
    enabled: searching,
    staleTime: 5 * 60_000,
  });
  const current = (images.data ?? []).filter((i) => i.ImageType === type);

  const changed = async (message: string) => {
    await images.refetch();
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "manage" });
    showToast(message);
  };

  const attempt = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await changed(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (img: RemoteImage) => img.Url && attempt(() => downloadRemoteImage(item.Id, type, img.Url!), `${meta.label} updated`);

  return (
    <Dialog title="Edit images" subtitle={item.SeriesName ? `${item.SeriesName} · ${item.Name}` : item.Name} wide busy={busy}>
      {types.length > 1 && (
        <div className="tabs mimg__tabs" role="tablist" aria-label="Image type">
          {types.map((t) => (
            <button
              key={t.type}
              role="tab"
              aria-selected={type === t.type}
              className={type === t.type ? "is-active" : ""}
              onClick={() => {
                setType(t.type);
                setSearching(false);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <section className="mimg__current">
        {images.isPending ? (
          <Spinner />
        ) : current.length ? (
          <div className={`mimg__grid ${meta.wide ? "is-wide" : ""}`}>
            {current.map((img) => (
              <figure className="mimg__tile" key={`${img.ImageType}-${img.ImageIndex ?? 0}-${img.ImageTag}`}>
                <img
                  src={client().imageUrl(item.Id, type as ImageType, { tag: img.ImageTag, index: type === "Backdrop" ? (img.ImageIndex ?? 0) : undefined, maxWidth: 480 })}
                  alt=""
                  className={type === "Logo" ? "is-logo" : ""}
                />
                <figcaption>
                  <span>{img.Width && img.Height ? `${img.Width} × ${img.Height}` : ""}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    onClick={() => attempt(() => deleteItemImage(item.Id, type, type === "Backdrop" ? (img.ImageIndex ?? 0) : undefined), `${meta.label} removed`)}
                  >
                    Remove
                  </Button>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="muted mimg__none">No {meta.label.toLowerCase()} yet.</p>
        )}
      </section>

      <div className="mimg__actions">
        <Button variant="secondary" icon="upload" disabled={busy} onClick={() => file.current?.click()}>
          Upload
        </Button>
        <Button variant={searching ? "primary" : "secondary"} icon="search" disabled={busy} onClick={() => setSearching(true)}>
          Search online
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) attempt(() => uploadItemImage(item.Id, type, f), `${meta.label} uploaded`);
          }}
        />
        {searching && (
          <label className="check mimg__langs">
            <input type="checkbox" checked={allLanguages} onChange={(e) => setAllLanguages(e.target.checked)} />
            All languages
          </label>
        )}
      </div>

      {searching && (
        <section className="mimg__remote">
          {remote.isPending ? (
            <Spinner label="Searching providers" />
          ) : remote.isError ? (
            <p className="mdialog__error">{errorText(remote.error)}</p>
          ) : remote.data?.Images.length ? (
            <div className={`mimg__grid ${meta.wide ? "is-wide" : ""}`}>
              {remote.data.Images.map((img, i) => (
                <button className="mimg__tile mimg__choice" key={`${img.Url}-${i}`} disabled={busy} onClick={() => pick(img)} title="Use this image">
                  <img src={img.ThumbnailUrl || img.Url} alt="" loading="lazy" referrerPolicy="no-referrer" className={type === "Logo" ? "is-logo" : ""} />
                  <span className="mimg__meta">
                    <span>{img.ProviderName}</span>
                    <span>
                      {[img.Width && img.Height ? `${img.Width}×${img.Height}` : "", img.Language?.toUpperCase(), img.CommunityRating ? `★ ${img.CommunityRating.toFixed(1)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted mimg__none">No {meta.label.toLowerCase()} found online{allLanguages ? "" : " in your language. Try all languages"}.</p>
          )}
        </section>
      )}
      {error && <p className="mdialog__error">{error}</p>}
    </Dialog>
  );
}
