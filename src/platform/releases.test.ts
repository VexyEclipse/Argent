import { describe, expect, it } from "vitest";
import { apkOf, isNewer } from "./releases";

describe("isNewer", () => {
  it("compares numerically, not as text", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.7.0", "0.6.2")).toBe(true);
    expect(isNewer("v0.7.0", "0.7.0")).toBe(false);
    expect(isNewer("0.6.1", "0.6.2")).toBe(false);
  });
  it("puts a pre-release before its release", () => {
    expect(isNewer("0.7.0", "0.7.0-beta")).toBe(true);
    expect(isNewer("0.7.0-beta", "0.7.0")).toBe(false);
    expect(isNewer("0.7.0-beta.2", "0.7.0-beta.1")).toBe(true);
  });
});

describe("apkOf", () => {
  const release = {
    tag_name: "v0.7.0",
    assets: [
      { name: "Argent-Setup-0.7.0.exe", browser_download_url: "https://x/exe" },
      { name: "Argent-0.7.0.apk", browser_download_url: "https://x/apk" },
    ],
  };
  it("finds the APK", () => expect(apkOf(release)).toEqual({ version: "0.7.0", url: "https://x/apk" }));
  it("ignores releases without one", () => expect(apkOf({ ...release, assets: release.assets.slice(0, 1) })).toBeNull());
  it("ignores drafts", () => expect(apkOf({ ...release, draft: true })).toBeNull());
});
