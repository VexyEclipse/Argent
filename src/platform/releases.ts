// Pure helpers for reading the project's GitHub releases (Android updates).

/** 0.6.2 < 0.7.0 < 0.10.0; a "-beta" suffix sorts before its release. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/i, "").split("-");
    return { parts: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const d = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (d) return d > 0;
  }
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  return a.pre > b.pre;
}

export interface Release {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: { name: string; browser_download_url: string }[];
}

/** The APK in a release (Argent-<version>.apk). */
export function apkOf(release: Release): { version: string; url: string } | null {
  const asset = release.assets.find((a) => /^Argent-.+\.apk$/i.test(a.name));
  if (!asset || release.draft) return null;
  return { version: release.tag_name.replace(/^v/i, ""), url: asset.browser_download_url };
}
