import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  // The app version (package.json), shown in Settings and sent to Jellyfin with every request.
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    // Build output that the dev server never serves. Desktop and Android packaging wipe and
    // recreate these folders, which can leave the file watcher rescanning in a busy loop.
    watch: {
      ignored: ["**/android/**", "**/release/**", "**/dist/**", "**/build/**", "**/.claude/**"],
    },
  },
  preview: { port: 4173, host: true },
  build: {
    target: "es2022",
    sourcemap: true,
    // hls.js (~580 kB) is its own chunk, loaded only when a stream is transcoded to HLS.
    chunkSizeWarningLimit: 650,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
