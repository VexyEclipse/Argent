export interface AppConfig {
  defaultServerUrl: string;
  mediaBar: Record<string, unknown> & { lock?: string[] };
}

const FALLBACK: AppConfig = { defaultServerUrl: "", mediaBar: {} };

let pending: Promise<AppConfig> | null = null;

/** Deployment config from /argent.config.json (editable after build). */
export function loadAppConfig(): Promise<AppConfig> {
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}argent.config.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .then((json) => ({ ...FALLBACK, ...json, mediaBar: { ...(json?.mediaBar ?? {}) } }))
      .catch(() => FALLBACK);
  }
  return pending;
}
