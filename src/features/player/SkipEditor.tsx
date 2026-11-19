import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { Icon } from "@/components/Icon";
import { deleteSkip, skipPlace, updateSkip, useSavedSkips, type SkipEdit, type SkipEditorState } from "./learnedSkips";
import { cleanSkipName, editedRange, formatSkipTime, MAX_NAME_LENGTH, NUDGE, parseSkipTime, type SavedSkip } from "./skipLearning";
import "./skipEditor.css";

/** An offer nobody touches goes away after this long; one being edited stays. */
const OFFER_MS = 20_000;

/** The video the form is set against: it shows each edge as it changes, and "Now" reads it. */
interface FormVideo {
  currentTime: () => number;
  seek: (seconds: number) => void;
}

/**
 * The skip editor in the player, with two tabs. This season: its skip offered, adjusted or
 * set by hand, with its start and end to the tenth of a second (nudge, type a time, or play
 * or scrub to the moment and press Now; each change shows that frame), what its Skip card
 * calls it, and whether it asks first or skips on its own. All skips: every season's skip,
 * to edit or delete. In a film there's only the list.
 */
export function SkipEditor({
  state,
  duration,
  currentTime,
  onSeek,
  onSave,
  onForget,
  onClose,
}: {
  state: SkipEditorState;
  duration: number;
  currentTime: () => number;
  onSeek: (seconds: number) => void;
  onSave: (edit: SkipEdit) => void;
  onForget: () => void;
  onClose: () => void;
}) {
  const saved = useSavedSkips();
  const [tab, setTab] = useState<"season" | "all">(state.mode === "list" ? "all" : "season");
  const [touched, setTouched] = useState(state.mode !== "offer");
  const touch = () => setTouched(true);

  useEffect(() => {
    if (touched) return;
    const t = window.setTimeout(onClose, OFFER_MS);
    return () => window.clearTimeout(t);
  }, [touched, onClose]);

  // A skip deleted from the list leaves this season's form as a new one.
  const exists = saved.some((s) => s.key === state.key);
  const mode = state.mode === "edit" && !exists ? "create" : state.mode;
  const offer = mode === "offer";

  return (
    <div className="skipedit skipedit--card fade-in" role="dialog" aria-label={offer ? "Skip this in every episode?" : "Skips"} onPointerDown={touch} onFocus={touch}>
      {mode !== "list" && (
        <div className="skipedit__tabs" role="tablist">
          <button className={`skipedit__tab ${tab === "season" ? "is-on" : ""}`} role="tab" aria-selected={tab === "season"} onClick={() => setTab("season")}>
            This season
          </button>
          <button className={`skipedit__tab ${tab === "all" ? "is-on" : ""}`} role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
            All skips{saved.length ? ` · ${saved.length}` : ""}
          </button>
        </div>
      )}

      {/* Both stay mounted, so switching tabs keeps what's been typed. */}
      {mode !== "list" && (
        <div className="skipedit__pane" role="tabpanel" hidden={tab !== "season"}>
          <span className="eyebrow">{offer ? "Learned from your skips" : mode === "create" ? `New skip · ${state.season}` : `Skip · ${state.season}`}</span>
          <span className="skipedit__title">{offer ? `Skip this in every episode of ${state.season}?` : mode === "create" ? "Skip a part of every episode" : "Adjust it for every episode"}</span>
          <SkipForm
            initial={state}
            duration={duration}
            video={{ currentTime, seek: onSeek }}
            onTouch={touch}
            onSave={onSave}
            saveLabel={offer ? "Skip it" : "Save"}
            autoFocusSave={!offer}
            actions={
              <>
                {mode === "edit" && (
                  <button className="btn btn--ghost btn--sm" onClick={onForget}>
                    Delete
                  </button>
                )}
                <button className="btn btn--ghost btn--sm" onClick={onClose}>
                  {offer ? "Not now" : "Cancel"}
                </button>
              </>
            }
          />
        </div>
      )}
      <div className="skipedit__pane" role="tabpanel" hidden={tab !== "all"}>
        {mode === "list" && <span className="skipedit__title">Your skips</span>}
        <SkipList compact currentKey={state.key} onEditCurrent={() => setTab("season")} />
        <div className="skipedit__actions">
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Every season's skip: what it's called, the show and season, its times and whether it
 * asks first, each to edit in place or delete (a toast can bring it back). In the player
 * and in Settings → Skipping.
 */
export function SkipList({ compact, currentKey, onEditCurrent }: { compact?: boolean; currentKey?: string; onEditCurrent?: () => void }) {
  const saved = useSavedSkips();
  const [editing, setEditing] = useState<string | null>(null);
  if (!saved.length)
    return <p className="skiplist__empty">No skips yet. Accept one Argent offers, or press the editor's shortcut in an episode to set one.</p>;
  return (
    <ul className={`skiplist ${compact ? "skiplist--compact" : ""}`}>
      {saved.map((s) => (
        <SkipRow
          key={s.key}
          skip={s}
          current={s.key === currentKey}
          editing={editing === s.key}
          onEdit={() => (s.key === currentKey && onEditCurrent ? onEditCurrent() : setEditing(s.key))}
          onDone={() => setEditing(null)}
          linkShow={!compact}
        />
      ))}
    </ul>
  );
}

function SkipRow({ skip, current, editing, onEdit, onDone, linkShow }: { skip: SavedSkip; current: boolean; editing: boolean; onEdit: () => void; onDone: () => void; linkShow: boolean }) {
  const { user } = useAuth();
  const { key, entry } = skip;
  const place = skipPlace(entry);
  return (
    <li className={`skiplist__item ${current ? "is-current" : ""}`}>
      <div className="skiplist__row">
        <div className="skiplist__text">
          <span className="skiplist__name">
            {entry.name ?? "Intro"}
            {current && <span className="skiplist__tag">Watching</span>}
          </span>
          <span className="skiplist__place">{linkShow && entry.seriesId ? <Link to={`/details/${entry.seriesId}`}>{place}</Link> : place}</span>
          <span className="skiplist__meta">
            {formatSkipTime(entry.range.start)}–{formatSkipTime(entry.range.end)} · {entry.auto ? "Skips automatically" : "Asks first"}
          </span>
        </div>
        {!editing && user && (
          <div className="skiplist__actions">
            <button className="btn btn--secondary btn--sm" onClick={onEdit} aria-label={`Edit the skip for ${place}`}>
              <Icon name="pencil" size={14} /> Edit
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => deleteSkip(user.Id, key)} aria-label={`Delete the skip for ${place}`}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        )}
      </div>
      {editing && user && (
        <SkipForm
          initial={{ range: entry.range, name: entry.name, auto: Boolean(entry.auto) }}
          duration={entry.ref ?? 0}
          onSave={(edit) => {
            updateSkip(user.Id, key, edit);
            onDone();
          }}
          saveLabel="Save"
          autoFocusSave
          actions={
            <button className="btn btn--ghost btn--sm" onClick={onDone}>
              Cancel
            </button>
          }
        />
      )}
    </li>
  );
}

/**
 * A skip's start and end (to the tenth of a second), its name and whether it asks first.
 * Against a video, each change shows that frame and Now takes the video's time; without one
 * (the list), times are typed or nudged.
 */
function SkipForm({
  initial,
  duration,
  video,
  onTouch,
  onSave,
  saveLabel,
  autoFocusSave,
  actions,
}: {
  initial: SkipEdit;
  /** For keeping the edges inside the episode; 0 when unknown. */
  duration: number;
  video?: FormVideo;
  onTouch?: () => void;
  onSave: (edit: SkipEdit) => void;
  saveLabel: string;
  autoFocusSave?: boolean;
  actions: ReactNode;
}) {
  const nameId = useId();
  const [draft, setDraft] = useState(initial.range);
  const [name, setName] = useState(initial.name ?? "");
  const [auto, setAuto] = useState(initial.auto);

  const change = (edge: "start" | "end", value: number, show = true) => {
    onTouch?.();
    const next = editedRange(draft, edge, value, duration);
    setDraft(next);
    if (show) video?.seek(next[edge]);
  };
  const now = video ? (edge: "start" | "end") => change(edge, video.currentTime(), false) : undefined;

  return (
    <div className="skipedit__form">
      <EdgeRow label="Starts" value={draft.start} onChange={(v) => change("start", v)} now={now && (() => now("start"))} />
      <EdgeRow label="Ends" value={draft.end} onChange={(v) => change("end", v)} now={now && (() => now("end"))} />
      <span className="skipedit__hint">{video ? "Play or scrub to the moment and press Now, or type a time." : "Type a time, or move it half a second with the arrows."}</span>
      <div className="skipedit__row">
        <label className="skipedit__label" htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className="skipedit__name"
          value={name}
          placeholder="Intro, Opening, Recap…"
          maxLength={MAX_NAME_LENGTH}
          spellCheck={false}
          onChange={(e) => {
            onTouch?.();
            setName(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>
      <div className="skipedit__row" role="radiogroup" aria-label="How to skip it">
        <span className="skipedit__label">Skip</span>
        <div className="skipedit__choice">
          {(
            [
              [false, "Ask first"],
              [true, "Automatically"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={String(value)}
              className={`skipedit__option ${auto === value ? "is-on" : ""}`}
              role="radio"
              aria-checked={auto === value}
              onClick={() => {
                onTouch?.();
                setAuto(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="skipedit__actions">
        <button className="btn btn--primary btn--sm" onClick={() => onSave({ range: draft, name: cleanSkipName(name), auto })} autoFocus={autoFocusSave}>
          <Icon name="check" size={14} /> {saveLabel}
        </button>
        {actions}
      </div>
    </div>
  );
}

function EdgeRow({ label, value, onChange, now }: { label: string; value: number; onChange: (seconds: number) => void; now?: () => void }) {
  const [text, setText] = useState(() => formatSkipTime(value));
  useEffect(() => setText(formatSkipTime(value)), [value]);
  const commit = () => {
    const typed = parseSkipTime(text);
    if (typed === undefined || typed === value) setText(formatSkipTime(value));
    else onChange(typed);
  };
  return (
    <div className="skipedit__row">
      <span className="skipedit__label">{label}</span>
      <button className="skipedit__nudge" onClick={() => onChange(value - NUDGE)} aria-label={`${label} ${NUDGE} seconds earlier`} title={`${NUDGE} s earlier`}>
        <Icon name="chevronLeft" size={16} />
      </button>
      <input
        className="skipedit__time"
        value={text}
        inputMode="decimal"
        spellCheck={false}
        aria-label={`${label} at`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setText(formatSkipTime(value));
            // Blur after the reset lands, so commit sees the old time.
            const el = e.currentTarget;
            window.setTimeout(() => el.blur());
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(value + (e.key === "ArrowUp" ? NUDGE : -NUDGE));
          }
        }}
      />
      <button className="skipedit__nudge" onClick={() => onChange(value + NUDGE)} aria-label={`${label} ${NUDGE} seconds later`} title={`${NUDGE} s later`}>
        <Icon name="chevronRight" size={16} />
      </button>
      {now && (
        <button className="btn btn--ghost btn--sm skipedit__now" onClick={now} title="Use where the video is now">
          Now
        </button>
      )}
    </div>
  );
}
