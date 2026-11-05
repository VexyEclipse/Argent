import { useEffect, useRef, useState } from "react";
import { posterImage } from "@/api/images";
import type { BaseItem } from "@/api/types";
import { Artwork } from "@/components/Artwork";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { moveWithinScore, sortRatings, topTiers, type RatingEntry } from "@/features/ratings/logic";
import { saveOrder } from "@/features/ratings/store";

const TOP = 10;

/**
 * Put your top 10 in order. Scores stay in charge: you can only reorder titles that
 * share a score, so your 10s stay above your 9s. Every title with a score that reaches
 * the top 10 is listed, so one just outside it can be moved up within its score.
 */
export function TopOrderDialog({
  userId,
  ranked,
  items,
  onClose,
}: {
  userId: string;
  ranked: [string, RatingEntry][];
  items: Map<string, BaseItem>;
  onClose: () => void;
}) {
  // Edits apply as they're made; the list keeps its own copy so it can't jump while you work.
  const [list, setList] = useState(ranked);
  const [moved, setMoved] = useState<string | null>(null);
  const focusAfterMove = useRef<{ id: string; dir: -1 | 1 } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const move = (id: string, dir: -1 | 1) => {
    const ids = moveWithinScore(list, id, dir);
    if (!ids) return;
    const byId = new Map(list);
    const next = sortRatings(
      ids.map((x) => [x, byId.get(x)!]),
      "stars",
      ids,
    );
    setList(next);
    setMoved(id);
    focusAfterMove.current = { id, dir };
    saveOrder(userId, ids);
  };

  // Keep focus on the button that was pressed as its row moves (keyboard and TV remote).
  useEffect(() => {
    const f = focusAfterMove.current;
    if (!f) return;
    focusAfterMove.current = null;
    const button = document.querySelector<HTMLButtonElement>(`[data-order-id="${f.id}"][data-dir="${f.dir}"]`);
    if (button && !button.disabled) button.focus();
    else document.querySelector<HTMLButtonElement>(`[data-order-id="${f.id}"]:not(:disabled)`)?.focus();
  }, [list]);

  const tiers = topTiers(list, TOP);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-label="Order your top 10" data-nav-trap>
      <div className="modal mp-order" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <h2 className="modal__title">Order your top 10</h2>
            <p className="mp-order__hint">Titles move only among others with the same score.</p>
          </div>
          <Button variant="icon" icon="close" aria-label="Close" onClick={onClose} />
        </header>
        <div className="mp-order__body">
          {tiers.map((tier) => (
            <section key={tier.stars} className="mp-order__tier" aria-label={`Scored ${tier.stars}`}>
              <h3 className="mp-order__score">
                <Icon name="star" size={15} /> {tier.stars}
                <span className="mp-order__count">
                  {tier.titles.length} {tier.titles.length === 1 ? "title" : "titles"}
                </span>
              </h3>
              <ol className="mp-order__list">
                {tier.titles.map((t, i) => {
                  const item = items.get(t.id);
                  const outside = t.rank > TOP;
                  return (
                    <li key={t.id} className={`mp-order__row ${outside ? "is-outside" : ""} ${moved === t.id ? "is-moved" : ""}`}>
                      <span className="mp-order__rank">{outside ? "–" : t.rank}</span>
                      <span className="mp-order__poster">{item && <Artwork image={posterImage(item, 120)} alt="" />}</span>
                      <span className="mp-order__name">
                        {t.entry.name}
                        {outside && <span className="mp-order__out">Outside your top 10</span>}
                      </span>
                      <span className="mp-order__moves">
                        <Button
                          variant="icon"
                          size="sm"
                          icon="arrowUp"
                          data-order-id={t.id}
                          data-dir={-1}
                          disabled={i === 0}
                          onClick={() => move(t.id, -1)}
                          aria-label={`Move ${t.entry.name} up`}
                          title="Move up"
                        />
                        <Button
                          variant="icon"
                          size="sm"
                          icon="arrowDown"
                          data-order-id={t.id}
                          data-dir={1}
                          disabled={i === tier.titles.length - 1}
                          onClick={() => move(t.id, 1)}
                          aria-label={`Move ${t.entry.name} down`}
                          title="Move down"
                        />
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        <footer className="mp-order__foot">
          <span className="mp-order__hint">Saved as you go, and synced to your other devices.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}
