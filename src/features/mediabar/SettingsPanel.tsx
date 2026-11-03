import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getViews } from "@/api/jellyfin";
import { Icon } from "@/components/Icon";
import type { MediaBarConfig } from "./config";
import type { useMediaBarConfig } from "./useMediaBarConfig";

type MB = ReturnType<typeof useMediaBarConfig>;

// Same fields, in the same order, as the plugin's gear panel.
type Field =
  | { key: keyof MediaBarConfig | "contentMode"; label: string; type: "choice"; options: [string, string][]; hint?: string }
  | { key: keyof MediaBarConfig; label: string; type: "switch"; hint?: string }
  | { key: keyof MediaBarConfig; label: string; type: "range"; min: number; max: number; step: number; format: (v: number) => string }
  | { key: keyof MediaBarConfig; label: string; type: "libraries"; hint?: string };

const FIELDS: Field[] = [
  {
    key: "layout",
    label: "Layout",
    type: "choice",
    options: [
      ["plate", "Plate"],
      ["marquee", "Marquee"],
      ["classic", "Classic"],
    ],
  },
  {
    key: "contentMode",
    label: "Display",
    type: "choice",
    options: [
      ["all", "Everything"],
      ["movies", "Movies"],
      ["series", "TV shows"],
      ["even", "Even mix"],
    ],
  },
  { key: "libraries", label: "Libraries", type: "libraries", hint: "None selected = all libraries" },
  { key: "shuffleInterval", label: "Slide duration", type: "range", min: 4000, max: 60000, step: 1000, format: (v) => `${Math.round(v / 1000)}s` },
  { key: "slideAnimationEnabled", label: "Motion effects", type: "switch" },
  { key: "syncPageBackdrop", label: "Sync page backdrop", type: "switch" },
  { key: "pauseOnHover", label: "Pause on hover", type: "switch" },
  { key: "enableTrailers", label: "Trailers", type: "switch" },
  { key: "allowTrailersOnTouch", label: "Trailers on phones", type: "switch" },
  { key: "trailerVolume", label: "Trailer volume", type: "range", min: 0, max: 100, step: 5, format: (v) => `${v}%` },
  { key: "trailerCaptions", label: "Trailer captions", type: "switch" },
  { key: "trailerLibraries", label: "Trailers from", type: "libraries", hint: "None selected = every library" },
  { key: "rememberOrderForSession", label: "Resume where I left off", type: "switch" },
  { key: "respectDataSaver", label: "Respect data saver", type: "switch" },
];

function readContentMode(c: MediaBarConfig) {
  if (!c.maxMovies && !c.maxSeries) return "all";
  if (c.maxMovies && !c.maxSeries) return "movies";
  if (!c.maxMovies && c.maxSeries) return "series";
  return "even";
}

function writeContentMode(value: string, c: MediaBarConfig) {
  const total = c.maxItems;
  const half = Math.max(1, Math.round(total / 2));
  if (value === "movies") return { maxMovies: total, maxSeries: 0 };
  if (value === "series") return { maxMovies: 0, maxSeries: total };
  if (value === "even") return { maxMovies: half, maxSeries: half };
  return { maxMovies: 0, maxSeries: 0 };
}

export function SettingsPanel({ mb, onClose }: { mb: MB; onClose: () => void }) {
  const { config, locked, update, reset } = mb;
  const panel = useRef<HTMLDivElement>(null);
  const views = useQuery({ queryKey: ["views"], queryFn: getViews, staleTime: 5 * 60_000 });
  const libraries = (views.data?.Items ?? []).filter((v) => !v.CollectionType || ["movies", "tvshows", "mixed", "homevideos"].includes(v.CollectionType));

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (panel.current?.contains(target) || target.closest("[aria-label='Featured settings']")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isLocked = (key: string) => locked.has(key) || (key === "contentMode" && (locked.has("maxMovies") || locked.has("maxSeries")));

  return (
    <div className="mb-settings" ref={panel} role="dialog" aria-label="Featured settings" data-nav-trap>
      <div className="mb-settings__header">
        <span className="eyebrow">Featured</span>
        <button className="mb-ctrl" onClick={onClose} aria-label="Close settings">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="mb-settings__body">
        {FIELDS.map((field) => {
          const disabled = isLocked(field.key);
          if (field.type === "choice") {
            const value = field.key === "contentMode" ? readContentMode(config) : String(config[field.key as keyof MediaBarConfig]);
            return (
              <div className="mb-field" key={field.key}>
                <span className="mb-field__label">{field.label}</span>
                <div className="mb-segment" role="radiogroup" aria-label={field.label}>
                  {field.options.map(([v, label]) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={value === v}
                      className={value === v ? "is-active" : ""}
                      disabled={disabled}
                      onClick={() => update(field.key === "contentMode" ? writeContentMode(v, config) : { [field.key]: v })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (field.type === "switch") {
            const value = Boolean(config[field.key]);
            return (
              <div className="mb-field mb-field--inline" key={field.key}>
                <span className="mb-field__label">{field.label}</span>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={value}
                  aria-label={field.label}
                  disabled={disabled}
                  onClick={() => update({ [field.key]: !value })}
                />
              </div>
            );
          }
          if (field.type === "range") {
            const value = Number(config[field.key]);
            return (
              <label className="mb-field" key={field.key}>
                <span className="mb-field__label">
                  {field.label}
                  <span className="mb-field__value">{field.format(value)}</span>
                </span>
                <input
                  type="range"
                  className="range"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => update({ [field.key]: Number(e.target.value) })}
                />
              </label>
            );
          }
          const selected = new Set((config[field.key] as string[]).map((s) => s.toLowerCase()));
          return (
            <div className="mb-field" key={field.key}>
              <span className="mb-field__label">{field.label}</span>
              <div className="mb-libraries">
                {libraries.map((lib) => {
                  const on = selected.has(lib.Name.toLowerCase());
                  return (
                    <button
                      key={lib.Id}
                      className={`chip ${on ? "is-active" : ""}`}
                      aria-pressed={on}
                      disabled={disabled}
                      onClick={() => {
                        const current = config[field.key] as string[];
                        const nextList = on ? current.filter((n) => n.toLowerCase() !== lib.Name.toLowerCase()) : [...current, lib.Name];
                        update({ [field.key]: nextList });
                      }}
                    >
                      {lib.Name}
                    </button>
                  );
                })}
              </div>
              {field.hint && <span className="mb-field__hint">{field.hint}</span>}
            </div>
          );
        })}
      </div>
      <div className="mb-settings__footer">
        <button className="btn btn--ghost btn--sm" onClick={reset}>
          Reset to server defaults
        </button>
      </div>
    </div>
  );
}
