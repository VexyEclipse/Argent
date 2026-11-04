import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

  useEffect(() => {
    document.documentElement.dataset.platform = platform;
  }, [platform]);

  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export const usePlatform = () => useContext(PlatformContext);
