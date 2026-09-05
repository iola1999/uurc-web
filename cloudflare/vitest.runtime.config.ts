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
        outboundService(request) {
          const url = new URL(request.url);
          if (
            url.hostname === "api.nrd.nie.163.com" &&
            url.pathname === "/api/v1/room/join/by_device/synthetic-native"
          ) {
            return Response.json({
              code: 0,
              data: { room_config: { token: "synthetic-native-room", signal_servers: ["wss://signal.example"] } },
            });
          }
          const redirect = /\/redirect-(301|302|303|307|308)\/?$/.exec(url.pathname);
          if (redirect && ["api.nrd.nie.163.com", "signal.example"].includes(url.hostname)) {
            return new Response(null, {
              status: Number(redirect[1]),
              headers: { Location: "https://redirect-target.example/" },
            });
          }
          throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
        },
      },
    }),
  ],
  test: { include: ["tests/runtime/**/*.test.ts"] },
});
