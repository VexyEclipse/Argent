import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./Icon";
import { CardSkeleton, type CardVariant } from "./MediaCard";

interface Props {
  title: string;
  eyebrow?: string;
  seeAllTo?: string;
  loading?: boolean;
  variant?: CardVariant;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
}

/**
 * Horizontal carousel. Native scrolling (touch, trackpad, wheel+shift) with paged
 * arrow buttons on pointer devices and a D-pad row boundary for TV.
 */
export function Row({ title, eyebrow, seeAllTo, loading, variant = "poster", children, className = "", actions }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  // Whether the viewer has moved this row (swipe, sideways wheel, the arrows, focus by
  // keyboard or remote). Until they do, the row stays at its first card: the browser can
  // move it on its own (it keeps a snapped row on the card it showed when cards are
  // reordered, added in front or change size), and that is undone straight away.
  const moved = useRef(false);
  const settle = useRef(0);

  const holdStart = useCallback(() => {
    const el = track.current;
    if (el && !moved.current && el.scrollLeft > 0) el.scrollLeft = 0;
  }, []);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    holdStart();
    // Scrolled back to the start by the viewer: hold it there again, once it has stayed
    // there. Not at once: every scroll begins within a few pixels of the start.
    window.clearTimeout(settle.current);
    if (el.scrollLeft <= 4)
      settle.current = window.setTimeout(() => {
        if ((track.current?.scrollLeft ?? 0) <= 4) moved.current = false;
      }, 600);
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, [holdStart]);

  // New or reordered cards: back to the first one before the row is drawn.
  useLayoutEffect(holdStart, [children, loading, holdStart]);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const userMoves = () => {
    moved.current = true;
  };
  // A vertical wheel over a row scrolls the page, not the row.
  const onWheel = (e: React.WheelEvent) => {
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) userMoves();
  };

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    userMoves();
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className={`row row--${variant} ${className}`}>
      <header className="row__header">
        <div className="row__titles">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 className="row__title">
            {seeAllTo ? (
              <Link to={seeAllTo} className="row__title-link">
                {title}
                <Icon name="chevronRight" size={18} />
              </Link>
            ) : (
              title
            )}
          </h2>
        </div>
        {actions && <div className="row__actions">{actions}</div>}
      </header>
      <div className="row__viewport">
        {!edges.start && (
          <button className="row__arrow row__arrow--prev" onClick={() => page(-1)} aria-label="Scroll left" tabIndex={-1}>
            <Icon name="chevronLeft" size={26} />
          </button>
        )}
        <div
          className="row__track"
          ref={track}
          onScroll={measure}
          onWheel={onWheel}
          onTouchStart={userMoves}
          onPointerDown={userMoves}
          onKeyDown={userMoves}
          onFocus={userMoves}
          data-nav-row
        >
          {loading ? Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} variant={variant} />) : children}
        </div>
        {!edges.end && (
          <button className="row__arrow row__arrow--next" onClick={() => page(1)} aria-label="Scroll right" tabIndex={-1}>
            <Icon name="chevronRight" size={26} />
          </button>
        )}
      </div>
    </section>
  );
}
