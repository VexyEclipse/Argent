// Remote-control (D-pad) navigation for the TV interface. Arrow keys move focus to the
// geometrically nearest focusable element in that direction, preferring elements that
// overlap on the cross axis so rows and columns feel predictable. Containers marked
// [data-nav-trap] keep focus inside them (dialogs, the player).

type Direction = "up" | "down" | "left" | "right";

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

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && !el.closest("[inert],[aria-hidden='true']");
}

function candidates(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
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

export function moveFocus(dir: Direction): boolean {
  const current = document.activeElement as HTMLElement | null;
  const trap = (current?.closest("[data-nav-trap]") as HTMLElement | null) ?? document.querySelector<HTMLElement>("[data-nav-trap]");
  const scope: ParentNode = trap ?? document;
  const all = candidates(scope);
  if (!all.length) return false;

  if (!current || current === document.body || !scope.contains(current)) {
    const preferred = scope.querySelector<HTMLElement>("[data-autofocus]");
    (preferred && visible(preferred) ? preferred : all[0]).focus();
    return true;
  }

  // Rows marked data-nav-row keep left/right inside the row.
  const row = current.closest<HTMLElement>("[data-nav-row]");
  const pool = row && (dir === "left" || dir === "right") ? candidates(row) : all;

  const from = current.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of pool) {
    if (el === current || el.contains(current)) continue;
    const s = score(from, el.getBoundingClientRect(), dir);
    if (s !== null && s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

/** Install the D-pad handler. Returns a disposer. */
export function installSpatialNavigation(onBack: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    // Screens like the player handle the remote themselves.
    if (event.defaultPrevented || document.querySelector("[data-own-keys]")) return;
    const dir = KEY_DIRECTIONS[event.key];
    if (dir) {
      const target = event.target as HTMLElement;
      // Let range inputs and text fields keep their own arrow behaviour horizontally.
      if (isTyping() && (dir === "left" || dir === "right")) return;
      if (target?.getAttribute("type") === "range" && (dir === "left" || dir === "right")) return;
      if (moveFocus(dir)) event.preventDefault();
      return;
    }
    if (isBackKey(event)) {
      if (event.key === "Escape" && document.querySelector("[data-nav-trap]")) return;
      event.preventDefault();
      onBack();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
