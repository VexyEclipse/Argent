import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { SkipEdit, SkipEditorState } from "./learnedSkips";
import { cleanSkipName, editedRange, formatSkipTime, MAX_NAME_LENGTH, NUDGE, parseSkipTime } from "./skipLearning";

/** An offer nobody touches goes away after this long; one being edited stays. */
const OFFER_MS = 20_000;

/**
 * A learned skip: its start and end, editable to the tenth of a second (nudge with the
 * arrows, type a time, or play or scrub to the moment and press Now; each change shows that
 * frame), what its Skip card calls it, and whether it asks first or skips on its own.
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
  const offer = state.mode === "offer";
  const [draft, setDraft] = useState(state.range);
  const [name, setName] = useState(state.name ?? "");
  const [auto, setAuto] = useState(state.auto);
  const [touched, setTouched] = useState(!offer);

  useEffect(() => {
    if (touched) return;
    const t = window.setTimeout(onClose, OFFER_MS);
    return () => window.clearTimeout(t);
  }, [touched, onClose]);

  const change = (edge: "start" | "end", value: number, show = true) => {
    setTouched(true);
    const next = editedRange(draft, edge, value, duration);
    setDraft(next);
    if (show) onSeek(next[edge]);
  };

  return (
    <div className="skipedit fade-in" role="dialog" aria-label={offer ? "Skip this in every episode?" : "Learned skip"} onPointerDown={() => setTouched(true)} onFocus={() => setTouched(true)}>
      <span className="eyebrow">{offer ? "Learned from your skips" : state.mode === "create" ? `New skip · ${state.season}` : `Skip · ${state.season}`}</span>
      <span className="skipedit__title">{offer ? `Skip this in every episode of ${state.season}?` : state.mode === "create" ? "Skip a part of every episode" : "Adjust it for every episode"}</span>
      <EdgeRow label="Starts" value={draft.start} onChange={(v, show) => change("start", v, show)} now={() => change("start", currentTime(), false)} />
      <EdgeRow label="Ends" value={draft.end} onChange={(v, show) => change("end", v, show)} now={() => change("end", currentTime(), false)} />
      <span className="skipedit__hint">Play or scrub to the moment and press Now, or type a time.</span>
      <div className="skipedit__row">
        <label className="skipedit__label" htmlFor="skipedit-name">
          Name
        </label>
        <input
          id="skipedit-name"
          className="skipedit__name"
          value={name}
          placeholder="Intro, Opening, Recap…"
          maxLength={MAX_NAME_LENGTH}
          spellCheck={false}
          onChange={(e) => {
            setTouched(true);
            setName(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>
      <div className="skipedit__row" role="radiogroup" aria-label="How to skip it">
        <span className="skipedit__label">Skip</span>
        <div className="skipedit__choice">
          {[
            [false, "Ask first"],
            [true, "Automatically"],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              className={`skipedit__option ${auto === value ? "is-on" : ""}`}
              role="radio"
              aria-checked={auto === value}
              onClick={() => {
                setTouched(true);
                setAuto(value as boolean);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="skipedit__actions">
        <button className="btn btn--primary btn--sm" onClick={() => onSave({ range: draft, name: cleanSkipName(name), auto })} autoFocus={!offer}>
          <Icon name="check" size={14} /> {offer ? "Skip it" : "Save"}
        </button>
        {state.mode === "edit" && (
          <button className="btn btn--ghost btn--sm" onClick={onForget}>
            Forget
          </button>
        )}
        <button className="btn btn--ghost btn--sm" onClick={onClose}>
          {offer ? "Not now" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function EdgeRow({ label, value, onChange, now }: { label: string; value: number; onChange: (seconds: number, show?: boolean) => void; now: () => void }) {
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
      <button className="btn btn--ghost btn--sm skipedit__now" onClick={now} title="Use where the video is now">
        Now
      </button>
    </div>
  );
}
