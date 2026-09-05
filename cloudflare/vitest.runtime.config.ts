import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [
    cloudflareTest({
      main: new URL("./src/index.ts", import.meta.url).pathname,
      miniflare: {
        compatibilityDate: "2026-05-17",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: { REMOTE_SIGNAL_SESSION: { className: "RemoteSignalSession", useSQLite: true } },
      },
    }),
  ],
  test: { include: ["tests/runtime/**/*.test.ts"] },
});
