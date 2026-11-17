export interface AppConfig {
  defaultServerUrl: string;
  mediaBar: Record<string, unknown> & { lock?: string[] };
  /** A TMDB API key for everyone's Top 10 films and series (a user's own key wins). */
  tmdbApiKey?: string;
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
