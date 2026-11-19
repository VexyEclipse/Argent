import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HoverTarget } from "./store";

type Store = typeof import("./store");
type Listener = (e: unknown) => void;

let store: Store;
let listeners: Record<string, Listener>;
let at = { x: 0, y: 0 };

const card = (id: string): HoverTarget => ({
  item: { Id: id, Name: id, Type: "Movie" } as HoverTarget["item"],
  anchor: { isConnected: true } as HTMLElement,
  variant: "poster",
});
const open = () => store.readPreviewState().hover?.item.Id ?? null;
/** The pointer really moving, by (dx, dy). */
const move = (dx = 20, dy = 0) => {
  at = { x: at.x + dx, y: at.y + dy };
  listeners.pointermove({ pointerType: "mouse", clientX: at.x, clientY: at.y });
};
const wait = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  listeners = {};
  at = { x: 0, y: 0 };
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.resetModules();
  store = await import("./store");
  // The tracking starts with the first card; get it going so the moves below count.
  store.hoverEnter(card("warm-up"));
  store.closeHover();
  wait(1000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop hover previews", () => {
  it("open once the pointer has rested on a card", () => {
    move();
    store.hoverEnter(card("a"));
    wait(450);
    expect(open()).toBe(null);
    wait(60);
    expect(open()).toBe("a");
  });

  it("don't open while the pointer is passing over", () => {
    move();
    store.hoverEnter(card("a"));
    for (let i = 0; i < 60; i++) {
      wait(16);
      move();
    }
    expect(open()).toBe(null);
    store.hoverLeave();
    move();
    store.hoverEnter(card("b"));
    wait(100);
    move();
    store.hoverLeave();
    wait(2000);
    expect(open()).toBe(null);
  });

  it("count small wobbles as resting", () => {
    move();
    store.hoverEnter(card("a"));
    for (let i = 0; i < 6; i++) {
      wait(100);
      move(i % 2 ? 3 : -3, i % 2 ? 2 : -2);
    }
    expect(open()).toBe("a");
  });

  it("wait for the pointer to move when a card scrolls under it", () => {
    move();
    wait(1000);
    // The card arrives under the still pointer; the browser repeats where the pointer is.
    store.hoverEnter(card("a"));
    listeners.pointermove({ pointerType: "mouse", clientX: at.x, clientY: at.y });
    wait(3000);
    expect(open()).toBe(null);
    move(2);
    wait(510);
    expect(open()).toBe("a");
  });

  it("call off a card that starts scrolling before it opens", () => {
    const a = card("a");
    move();
    store.hoverEnter(a);
    wait(300);
    listeners.scroll({ target: { contains: (el: unknown) => el === a.anchor } });
    wait(3000);
    expect(open()).toBe(null);
    move(2);
    wait(510);
    expect(open()).toBe("a");
  });

  it("ignore scrolling elsewhere on the page", () => {
    move();
    store.hoverEnter(card("a"));
    wait(300);
    listeners.scroll({ target: { contains: () => false } });
    wait(210);
    expect(open()).toBe("a");
  });

  it("move along to a card the pointer rests on, but not to one scrolled under it", () => {
    move();
    store.hoverEnter(card("a"));
    wait(510);
    expect(open()).toBe("a");

    // Off the preview onto the next card, resting there briefly.
    move();
    store.hoverLeave();
    store.hoverEnter(card("b"));
    wait(200);
    expect(open()).toBe("a");
    wait(60);
    expect(open()).toBe("b");

    // The page scrolls: the preview leaves the pointer, and the card now under it stays shut.
    wait(1000);
    store.hoverLeave();
    store.hoverEnter(card("c"));
    wait(2000);
    expect(open()).toBe(null);
  });
});
