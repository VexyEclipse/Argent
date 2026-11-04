import type { ImageType } from "./types";

export const APP_NAME = "Argent";
export const APP_VERSION = "0.1.0";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type QueryValue = string | number | boolean | undefined | null | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Return the raw text instead of parsing JSON. */
  text?: boolean;
  /** Let the request outlive the page (playback stop reports on unload). */
  keepalive?: boolean;
}

const DEVICE_ID_KEY = "argent.deviceId";

/** 32 random hex characters. Not crypto.randomUUID, which only exists on https and localhost
 *  pages: the web version is often served over plain http on a home network. */
export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function readDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = randomId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function describeDevice(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Tizen|Web0S|webOS|SMART-TV/.test(ua)
            ? "TV"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

export function buildQuery(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function normaliseServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "").replace(/\/web(\/index\.html)?$/i, "");
}

/**
 * Thin, typed wrapper over the Jellyfin HTTP API. It owns the authorization header
 * and URL building; feature modules call it through src/api/jellyfin.ts.
 */
export class JellyfinClient {
  readonly deviceId = readDeviceId();
  readonly deviceName = describeDevice();
  serverUrl: string;
  accessToken: string | null;
  userId: string | null;

  constructor(serverUrl: string, accessToken: string | null = null, userId: string | null = null) {
    this.serverUrl = normaliseServerUrl(serverUrl);
    this.accessToken = accessToken;
    this.userId = userId;
  }

  authorizationHeader(): string {
    const parts = [`Client="${APP_NAME}"`, `Device="${this.deviceName.replace(/"/g, "")}"`, `DeviceId="${this.deviceId}"`, `Version="${APP_VERSION}"`];
    if (this.accessToken) parts.push(`Token="${this.accessToken}"`);
    return `MediaBrowser ${parts.join(", ")}`;
  }

  url(path: string, query?: Query): string {
    return `${this.serverUrl}${path}${buildQuery(query)}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", query, body, signal, text, keepalive } = options;
    const headers: Record<string, string> = { Authorization: this.authorizationHeader() };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(this.url(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      keepalive,
    });

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("argent:unauthorized"));
    }
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status} ${response.statusText}`);
    }
    if (text) return (await response.text()) as T;
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) return undefined as T;
    return (await response.json()) as T;
  }

  /** Image URL for an item. Tags make URLs cacheable forever by the browser. */
  imageUrl(itemId: string, type: ImageType, opts: { tag?: string; maxWidth?: number; maxHeight?: number; quality?: number; index?: number } = {}): string {
    const path = opts.index !== undefined ? `/Items/${itemId}/Images/${type}/${opts.index}` : `/Items/${itemId}/Images/${type}`;
    return this.url(path, {
      tag: opts.tag,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      quality: opts.quality ?? 90,
    });
  }

  userImageUrl(userId: string, tag?: string, size = 96): string {
    return this.url(`/Users/${userId}/Images/Primary`, { tag, maxWidth: size, quality: 90 });
  }
}
