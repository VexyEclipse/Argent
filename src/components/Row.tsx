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
  // Whether the row is at its first card. Only scrolling it changes that.
  const atStart = useRef(true);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    atStart.current = el.scrollLeft <= 4;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  // When the cards change (a refresh reorders them, new ones arrive in front), the browser
  // keeps the row snapped to the card it showed and follows it to its new place, leaving
  // the row part-way along. A row that hadn't been scrolled goes back to its first card,
  // before it's drawn; one that had keeps its place.
  useLayoutEffect(() => {
    const el = track.current;
    if (el && atStart.current && el.scrollLeft > 0) el.scrollLeft = 0;
  }, [children, loading]);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
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
        <div className="row__track" ref={track} onScroll={measure} data-nav-row>
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
