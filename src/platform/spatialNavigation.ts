// Remote-control (D-pad) navigation for the TV interface. Arrow keys move focus to the
// geometrically nearest focusable element in that direction, preferring elements that
// overlap on the cross axis so rows and columns feel predictable. Containers marked
// [data-nav-trap] keep focus inside them (dialogs, the player).
//
// Scrolling follows focus the way TV apps do: a carousel ([data-nav-carousel]) holds the
// focused card at its left edge and slides under it, remembering its place when you move
// to another row and back; the page brings the focused row to the same height every
// time. Scrolling glides towards where it's going and, pressed again on the way, simply
// heads for the new place, so holding an arrow moves in one smooth motion.

type Direction = "up" | "down" | "left" | "right";
type Axis = "x" | "y";

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Remote "back" keys: Escape, Backspace, Tizen (10009), webOS (461). */
export function isBackKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Escape" ||
    event.key === "GoBack" ||
    event.key === "BrowserBack" ||
    (event.key === "Backspace" && !isTyping()) ||
    event.keyCode === 10009 ||
    event.keyCode === 461
  );
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [data-focusable]';

/** Drawn and reachable. Called only for the few elements in the running, not every one. */
function shown(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && !el.closest("[inert],[aria-hidden='true']");
}

function hasSize(r: DOMRect): boolean {
  return r.width > 0 && r.height > 0;
}

function visible(el: HTMLElement): boolean {
  return hasSize(el.getBoundingClientRect()) && shown(el);
}

function firstVisible(scope: ParentNode): HTMLElement | null {
  for (const el of scope.querySelectorAll<HTMLElement>(FOCUSABLE)) if (visible(el)) return el;
  return null;
}

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function score(from: DOMRect, to: DOMRect, dir: Direction): number | null {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const EPS = 2;
  let primary: number;
  let cross: number;
  let overlap: number;
  switch (dir) {
    case "right":
      if (to.left < from.right - EPS && dx <= EPS) return null;
      primary = Math.max(0, to.left - from.right);
      cross = Math.abs(dy);
      overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
      break;
    case "left":
      if (to.right > from.left + EPS && dx >= -EPS) return null;
      primary = Math.max(0, from.left - to.right);
      cross = Math.abs(dy);
      overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
      break;
    case "down":
      if (to.top < from.bottom - EPS && dy <= EPS) return null;
      primary = Math.max(0, to.top - from.bottom);
      cross = Math.abs(dx);
      overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
      break;
    case "up":
      if (to.bottom > from.top + EPS && dy >= -EPS) return null;
      primary = Math.max(0, from.top - to.bottom);
      cross = Math.abs(dx);
      overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
      break;
  }
  // Elements aligned on the cross axis win decisively over diagonal ones.
  const alignedBonus = overlap > 0 ? 0 : 10_000;
  return alignedBonus + primary + cross * 2;
}

/** The nearest element in that direction. Geometry first; style is checked only for the closest few. */
function nearest(scope: ParentNode, current: HTMLElement, dir: Direction, skip?: Element | null): HTMLElement | null {
  const from = current.getBoundingClientRect();
  const ranked: { el: HTMLElement; s: number }[] = [];
  for (const el of scope.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el === current || el.contains(current) || skip?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (!hasSize(r)) continue;
    const s = score(from, r, dir);
    if (s !== null) ranked.push({ el, s });
  }
  ranked.sort((a, b) => a.s - b.s);
  return ranked.find((c) => shown(c.el))?.el ?? null;
}

// ---- carousels: each remembers its focused card ----------------------------------------

const CAROUSEL = "[data-nav-carousel]";
const lastInCarousel = new WeakMap<HTMLElement, HTMLElement>();

function remember(el: Element | null) {
  const track = el instanceof HTMLElement ? el.closest<HTMLElement>(CAROUSEL) : null;
  if (track) lastInCarousel.set(track, el as HTMLElement);
}

/** Coming into a carousel from above or below: where you left it, else its first card in view. */
function entryPoint(track: HTMLElement): HTMLElement | null {
  const last = lastInCarousel.get(track);
  if (last && last.isConnected && track.contains(last) && visible(last)) return last;
  const edge = track.getBoundingClientRect().left + parseFloat(getComputedStyle(track).paddingLeft) - 4;
  for (const card of Array.from(track.children) as HTMLElement[]) {
    if (card.getBoundingClientRect().left < edge) continue;
    const target = card.matches(FOCUSABLE) ? card : firstVisible(card);
    if (target && visible(target)) return target;
  }
  return null;
}

// ---- gliding scroll ----------------------------------------------------------------------

type Scroller = HTMLElement | "page";
interface Glide {
  pos: number;
  target: number;
  last: number;
  raf: number;
}
const glides = new Map<Scroller, Partial<Record<Axis, Glide>>>();
/** How quickly a glide closes in: about 95% of the way in three of these (≈ 0.2 s). */
const GLIDE_MS = 70;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function scrollPos(s: Scroller, axis: Axis): number {
  if (s === "page") return axis === "y" ? window.scrollY : window.scrollX;
  return axis === "y" ? s.scrollTop : s.scrollLeft;
}

function scrollMax(s: Scroller, axis: Axis): number {
  const el = s === "page" ? (document.scrollingElement ?? document.documentElement) : s;
  return Math.max(0, axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);
}

function jump(s: Scroller, axis: Axis, value: number) {
  const to: ScrollToOptions = axis === "y" ? { top: value, behavior: "instant" } : { left: value, behavior: "instant" };
  (s === "page" ? window : s).scrollTo(to);
}

function glideTo(s: Scroller, axis: Axis, to: number) {
  const target = Math.min(Math.max(0, Math.round(to)), scrollMax(s, axis));
  const slot = glides.get(s) ?? {};
  const running = slot[axis];
  if (reducedMotion()) {
    if (running) cancelAnimationFrame(running.raf);
    delete slot[axis];
    jump(s, axis, target);
    return;
  }
  // Already on the way somewhere: head for the new place without stopping.
  if (running) {
    running.target = target;
    return;
  }
  const pos = scrollPos(s, axis);
  if (Math.abs(target - pos) < 1) return;
  const glide: Glide = { pos, target, last: performance.now(), raf: 0 };
  slot[axis] = glide;
  glides.set(s, slot);
  const step = (now: number) => {
    if (s !== "page" && !s.isConnected) return stop(s);
    // By time, not frames: a slow TV takes bigger steps and arrives just as soon.
    const dt = Math.max(0, now - glide.last);
    glide.last = now;
    const left = glide.target - glide.pos;
    if (Math.abs(left) < 0.5) {
      jump(s, axis, glide.target);
      delete slot[axis];
      if (!slot.x && !slot.y) glides.delete(s);
      return;
    }
    glide.pos += left * (1 - Math.exp(-dt / GLIDE_MS));
    jump(s, axis, glide.pos);
    glide.raf = requestAnimationFrame(step);
  };
  glide.raf = requestAnimationFrame(step);
}

function stop(s: Scroller) {
  const slot = glides.get(s);
  if (slot) for (const g of Object.values(slot)) cancelAnimationFrame(g.raf);
  glides.delete(s);
}

/** Stops every glide: a new page starts where it starts, not where the last one was heading. */
export function stopScrolling() {
  for (const s of Array.from(glides.keys())) stop(s);
}

/** Where a scroll is heading (or is), so several moves in a row add up correctly. */
function heading(s: Scroller, axis: Axis): number {
  return glides.get(s)?.[axis]?.target ?? scrollPos(s, axis);
}

/** The element's scrolling containers: the nearest one on each axis, or the page. A fixed layer (the player, the rail) has none. */
function scrollers(el: HTMLElement): { x: HTMLElement | null; y: Scroller | null } {
  let x: HTMLElement | null = null;
  let y: Scroller | null = null;
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (!x && /(auto|scroll)/.test(style.overflowX) && p.scrollWidth > p.clientWidth) x = p;
    // A carousel's overflow-y reads "auto" too (CSS turns visible into auto beside a scrolling x), but it never scrolls that way.
    if (!y && /(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 2 && !p.matches(CAROUSEL)) y = p;
    if (style.position === "fixed") return { x, y };
    if (x && y) return { x, y };
  }
  return { x, y: y ?? "page" };
}

/** Within a container's view, with a margin: moves only as far as it has to. */
function intoBand(start: number, end: number, viewStart: number, viewEnd: number, margin: number): number {
  if (start < viewStart + margin) return start - (viewStart + margin);
  if (end > viewEnd - margin) return Math.min(end - (viewEnd - margin), start - (viewStart + margin));
  return 0;
}

/** A focused row sits this far down the screen, with the rows under it in view. */
const ROW_TOP = 0.1;

function follow(el: HTMLElement) {
  const { x, y } = scrollers(el);
  const r = el.getBoundingClientRect();

  if (x) {
    const box = x.getBoundingClientRect();
    if (x.matches(CAROUSEL)) {
      // Hold the focused card at the row's left edge; the row slides under it.
      let card: HTMLElement = el;
      while (card.parentElement && card.parentElement !== x) card = card.parentElement;
      const cardLeft = card.getBoundingClientRect().left - box.left + scrollPos(x, "x");
      glideTo(x, "x", cardLeft - parseFloat(getComputedStyle(x).paddingLeft));
    } else {
      const by = intoBand(r.left, r.right, box.left, box.right, Math.min(48, box.width / 6));
      if (by) glideTo(x, "x", heading(x, "x") + by);
    }
  }

  if (!y) return;
  if (y !== "page") {
    const box = y.getBoundingClientRect();
    const by = intoBand(r.top, r.bottom, box.top, box.bottom, Math.min(24, box.height / 8));
    if (by) glideTo(y, "y", heading(y, "y") + by);
    return;
  }
  // The page: positions on the page as a whole, aimed from where the page is heading.
  const view = window.innerHeight;
  const row = el.closest(CAROUSEL)?.closest<HTMLElement>(".row, section") ?? null;
  const box = (row ?? el).getBoundingClientRect();
  const top = box.top + window.scrollY;
  const bottom = box.bottom + window.scrollY;
  const from = heading("page", "y");
  let target: number;
  if (row && box.height < view * 0.85) target = top - view * ROW_TOP;
  else target = from + intoBand(top - from, bottom - from, 0, view, view * 0.12);
  // Near the top: show the whole top of the page (the featured header) rather than a sliver.
  if (bottom <= view * 0.92) target = 0;
  glideTo("page", "y", target);
}

export function moveFocus(dir: Direction): boolean {
  const current = document.activeElement as HTMLElement | null;
  const trap = (current?.closest("[data-nav-trap]") as HTMLElement | null) ?? document.querySelector<HTMLElement>("[data-nav-trap]");
  const scope: ParentNode = trap ?? document;

  if (!current || current === document.body || !scope.contains(current)) {
    const preferred = scope.querySelector<HTMLElement>("[data-autofocus]");
    const first = preferred && visible(preferred) ? preferred : firstVisible(scope);
    if (!first) return false;
    first.focus({ preventScroll: true });
    follow(first);
    return true;
  }

  // Rows marked data-nav-row keep left/right inside the row.
  const horizontal = dir === "left" || dir === "right";
  const row = current.closest<HTMLElement>("[data-nav-row]");
  const pool = row && horizontal ? row : scope;
  // Up and down go from row to row, past a card's own small buttons (remove, remind),
  // which stay reachable when there's nowhere else to go that way.
  const card = horizontal ? null : current.closest(".card");
  let best = nearest(pool, current, dir, card) ?? (card ? nearest(pool, current, dir) : null);
  if (!best) return false;

  // Into another carousel from above or below: where you were in it, like a TV app.
  if (!horizontal) {
    const track = best.closest<HTMLElement>(CAROUSEL);
    if (track && !track.contains(current)) best = entryPoint(track) ?? best;
  }

  best.focus({ preventScroll: true });
  follow(best);
  return true;
}

/** Holding an arrow: one move per this many ms, so the motion stays even. */
const REPEAT_MS = 110;

/** Install the D-pad handler. Returns a disposer. */
export function installSpatialNavigation(onBack: () => void): () => void {
  let lastMove = 0;
  const onKey = (event: KeyboardEvent) => {
    // Screens like the player handle the remote themselves.
    if (event.defaultPrevented || document.querySelector("[data-own-keys]")) return;
    const dir = KEY_DIRECTIONS[event.key];
    if (dir) {
      const target = event.target as HTMLElement;
      // Let range inputs and text fields keep their own arrow behaviour horizontally.
      if (isTyping() && (dir === "left" || dir === "right")) return;
      if (target?.getAttribute("type") === "range" && (dir === "left" || dir === "right")) return;
      const now = performance.now();
      if (event.repeat && now - lastMove < REPEAT_MS) {
        event.preventDefault();
        return;
      }
      if (moveFocus(dir)) {
        lastMove = now;
        event.preventDefault();
      }
      return;
    }
    if (isBackKey(event)) {
      if (event.key === "Escape" && document.querySelector("[data-nav-trap]")) return;
      event.preventDefault();
      onBack();
    }
  };
  // Focus that arrives another way (a click, a page opening) still counts as a row's place.
  const onFocusIn = (event: FocusEvent) => remember(event.target as Element);
  window.addEventListener("keydown", onKey);
  document.addEventListener("focusin", onFocusIn);
  return () => {
    // Reinstalled on every page change (see useTvNavigation).
    stopScrolling();
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("focusin", onFocusIn);
  };
}
