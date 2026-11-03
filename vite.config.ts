import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173, host: true },
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
