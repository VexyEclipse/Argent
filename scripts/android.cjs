// Builds the Android app (android/) from the current dist/ and copies the APK to
// release/Argent-<version>.apk, next to the desktop installer.
// Run with: npm run android:pack (which builds dist/ first)

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ANDROID = path.join(ROOT, "android");
const { version } = require(path.join(ROOT, "package.json"));
const gradlew = path.join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew");

if (!fs.existsSync(gradlew)) {
  console.error("android/gradlew is missing; restore it from git.");
  process.exit(1);
}

// Windows runs .bat files only through cmd.
const [command, args] = process.platform === "win32" ? ["cmd.exe", ["/d", "/c", gradlew, "assembleRelease"]] : [gradlew, ["assembleRelease"]];
const result = spawnSync(command, args, { cwd: ANDROID, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

const apk = path.join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk");
const out = path.join(ROOT, "release", `Argent-${version}.apk`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(apk, out);
console.log(`Wrote ${path.relative(ROOT, out)}`);
