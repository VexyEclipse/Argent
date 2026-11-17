import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

export type Platform = "desktop" | "mobile" | "tv";

const OVERRIDE_KEY = "argent.platform";
const MOBILE_MAX_WIDTH = 767;

function readOverride(): Platform | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get("platform");
    if (fromUrl === "desktop" || fromUrl === "mobile" || fromUrl === "tv") {
      localStorage.setItem(OVERRIDE_KEY, fromUrl);
      return fromUrl;
    }
    if (fromUrl === "auto") localStorage.removeItem(OVERRIDE_KEY);
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored === "desktop" || stored === "mobile" || stored === "tv") return stored;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function isTvUserAgent(ua = navigator.userAgent): boolean {
  // ArgentTV: the Argent Android app running on a TV (it only adds the token there).
  return /Tizen|Web0S|webOS|SMART-TV|SmartTV|HbbTV|AFT[A-Z]|Android TV|GoogleTV|CrKey|BRAVIA|Xbox|PlayStation|ArgentTV/i.test(ua);
}

export function detectPlatform(): Platform {
  const override = readOverride();
  if (override) return override;
  if (isTvUserAgent()) return "tv";
  const narrow = window.innerWidth <= MOBILE_MAX_WIDTH;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (narrow || (coarse && Math.min(window.innerWidth, window.innerHeight) <= 820)) return "mobile";
  return "desktop";
}

export function setPlatformOverride(value: Platform | "auto") {
  try {
    if (value === "auto") localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, value);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("argent:platform"));
}

export function getPlatformOverride(): Platform | "auto" {
  try {
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored === "desktop" || stored === "mobile" || stored === "tv") return stored;
  } catch {
    /* ignore */
  }
  return "auto";
}

/**
 * The TV interface is laid out on a page this wide and scaled to fill the screen, so it
 * looks the same on every TV. Without it, Android TV lays pages out 960 wide (a 1080p or
 * 4K screen at twice the density), where every card, title and gap came out twice the
 * size the design meant. Desktop browsers ignore it (`?platform=tv` there shows the page
 * at the window's own width).
 */
export const TV_PAGE_WIDTH = 1600;
let deviceViewport: string | null = null;
/** The screen's width before the TV page took over, which the page is scaled to. */
let deviceWidth = 0;

function applyTvViewport(on: boolean) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  if (deviceViewport === null) {
    deviceViewport = meta.content;
    deviceWidth = window.innerWidth;
  }
  if (!on) {
    meta.content = deviceViewport;
    return;
  }
  // A fixed scale, so nothing on the page can zoom it out further.
  const scale = Math.round((deviceWidth / TV_PAGE_WIDTH) * 1000) / 1000;
  meta.content = `width=${TV_PAGE_WIDTH}, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no`;
}

const PlatformContext = createContext<Platform>("desktop");

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);

  useEffect(() => {
    const update = () => setPlatform(detectPlatform());
    window.addEventListener("resize", update);
    window.addEventListener("argent:platform", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("argent:platform", update);
    };
  }, []);

  // Before the first paint, so the TV never shows a frame at the wrong size.
  useLayoutEffect(() => {
    document.documentElement.dataset.platform = platform;
    applyTvViewport(platform === "tv");
  }, [platform]);

  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export const usePlatform = () => useContext(PlatformContext);
