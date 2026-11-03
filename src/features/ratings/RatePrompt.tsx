import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { CARD_FIELDS, getItems } from "@/api/jellyfin";
import { backdropImage, logoImage, posterImage } from "@/api/images";
import { useAuth } from "@/auth/AuthProvider";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { usePlatform } from "@/platform/platform";
import { isBackKey } from "@/platform/spatialNavigation";
import { MAX_NOTE, type RateTarget, type RatingEntry } from "./logic";
import { clearRatePrompt, readRatePrompt, subscribeRatePrompt } from "./prompt";
import { pullRatingsFromServer, rate, removeRating, skipRating } from "./store";
import "./ratings.css";

interface DialogProps {
  target: RateTarget;
  /** Editing an existing rating rather than the post-watch prompt. */
  initial?: RatingEntry;
  onClose: (result?: { stars: number } | "removed") => void;
}

/** Full-screen "What would you rate X?" over the title's blurred backdrop. */
export function RateDialog({ target, initial, onClose }: DialogProps) {
  const { user } = useAuth();
  const platform = usePlatform();
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState(initial?.note ?? "");
  const firstStar = useRef<HTMLButtonElement>(null);
  const editing = Boolean(initial);

  const art = useQuery({
    queryKey: ["rate-target", target.id],
    queryFn: () => getItems({ ids: [target.id], fields: CARD_FIELDS }).then((r) => r.Items[0] ?? null),
    staleTime: 10 * 60_000,
  });
  const item = art.data;
  const backdrop = item ? backdropImage(item, 1280) : null;
  const logo = item ? logoImage(item, 640) : null;
  const poster = item ? posterImage(item, 240) : null;

  const save = () => {
    if (!user || !stars) return;
    rate(user.Id, target, stars, note);
    onClose({ stars });
  };
  const dismiss = () => {
    if (user && !editing) skipRating(user.Id, target.id);
    onClose();
  };
  const remove = () => {
    if (user) removeRating(user.Id, target.id);
    onClose("removed");
  };

  // Keep the latest handlers for the window listener without re-binding it.
  const keys = useRef({ dismiss, save });
  keys.current = { dismiss, save };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === "TEXTAREA";
      if (isBackKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        keys.current.dismiss();
      } else if (!typing && /^[0-9]$/.test(e.key)) {
        setStars(e.key === "0" ? 10 : Number(e.key));
      } else if (typing && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        keys.current.save();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (platform === "tv") firstStar.current?.focus();
  }, [platform]);

  const shown = hover || stars;

  return (
    <div className="rate" role="dialog" aria-modal="true" aria-label={`Rate ${target.name}`} data-nav-trap>
      {backdrop && <img className="rate__bg" src={backdrop.url} alt="" aria-hidden="true" />}
      <div className="rate__scrim" />
      <div className="rate__panel fade-in">
        <div className="rate__head">
          {poster && !logo && <Artwork image={poster} className="rate__poster" />}
          <span className="eyebrow">{editing ? "Your rating" : `Finished · ${target.type === "Series" ? "Series" : "Movie"}`}</span>
          {logo ? <img className="rate__logo" src={logo.url} alt={target.name} /> : null}
          <h2 className="rate__title">
            What would you rate <strong>{target.name}</strong>?
          </h2>
        </div>

        <div className="rate__stars" role="radiogroup" aria-label="Score out of 10" onMouseLeave={() => setHover(0)}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              ref={n === 1 ? firstStar : undefined}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} out of 10`}
              className={`rate__star ${n <= shown ? "is-on" : ""} ${hover && n <= hover ? "is-preview" : ""}`}
              onMouseEnter={() => setHover(n)}
              onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => setStars(n)}
            >
              <Icon name="star" size={platform === "tv" ? 40 : 30} />
            </button>
          ))}
        </div>
        <div className="rate__score" aria-live="polite">
          {shown ? (
            <>
              <strong>{shown}</strong>
              <span> / 10</span>
            </>
          ) : (
            <span className="rate__hint">Pick a score from 1 to 10</span>
          )}
        </div>

        <label className="field rate__note">
          <span className="field__label">Why? (optional)</span>
          <textarea
            className="input rate__textarea"
            value={note}
            maxLength={MAX_NOTE}
            rows={3}
            placeholder="What made it good, or bad?"
            onChange={(e) => setNote(e.target.value)}
          />
          {note.length > MAX_NOTE * 0.8 && <span className="rate__count">{MAX_NOTE - note.length} left</span>}
        </label>

        <div className="rate__actions">
          {editing && (
            <Button variant="ghost" icon="close" onClick={remove} className="rate__remove">
              Remove rating
            </Button>
          )}
          <span className="rate__spacer" />
          <Button variant="ghost" onClick={dismiss}>
            {editing ? "Cancel" : "Skip"}
          </Button>
          <Button variant="primary" icon="star" disabled={!stars} onClick={save}>
            {editing ? "Save" : "Save rating"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Shows the prompt the player queued once you're back from playback. */
export function RatePromptHost() {
  const { user } = useAuth();
  const target = useSyncExternalStore(subscribeRatePrompt, readRatePrompt);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (user?.Id) pullRatingsFromServer(user.Id);
  }, [user?.Id]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <>
      {target && (
        <RateDialog
          key={target.id}
          target={target}
          onClose={(result) => {
            clearRatePrompt();
            if (result && result !== "removed") setToast(`Rated ${target.name} ${result.stars}/10`);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
