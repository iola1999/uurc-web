import fs from "node:fs";
import path from "node:path";

import express from "express";
import compression from "compression";
import { createRuntimeProfile } from "@uurc/shared/runtimeProfile";
import { FRONTEND_APP_SHELL_FILE, FRONTEND_APP_SHELL_PATH, isFrontendAppRoute } from "@uurc/shared/frontendRoutes";

import { createConfig, type BackendConfigOverrides } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { createDiagnosticsRouter } from "./routes/diagnostics.js";
import { createProxyRouter } from "./routes/proxy.js";
import { createRemoteRouter } from "./routes/remote.js";
import type { SignalGatewayConnector } from "./services/signalGateway.js";
import { RemoteControlSessionRegistry } from "./services/remoteControlSessionRegistry.js";

export interface AppOverrides extends BackendConfigOverrides {
  signalGatewayConnector?: SignalGatewayConnector;
}

export function createApp(overrides: AppOverrides = {}) {
  const { signalGatewayConnector, ...configOverrides } = overrides;
  const config = createConfig(configOverrides);
  const remoteControlSessions = new RemoteControlSessionRegistry(signalGatewayConnector);
  const app = express();

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, runtime: "node" });
  });
  app.get("/api/runtime", (_req, res) => {
    res.json(createRuntimeProfile("node", { wispProxy: config.enableWisp }));
  });

  app.use("/api", createRemoteRouter(remoteControlSessions));
  app.use("/api", createProxyRouter(fetch, remoteControlSessions));

  if (config.enableDiagnostics) {
    app.use("/api", createDiagnosticsRouter(config));
  }

  const frontendDist = resolveFrontendDist();
  if (frontendDist) {
    app.use((req, res, next) => {
      const robotsHeader = getFrontendRobotsHeader(req.path);
      if (robotsHeader) res.setHeader("X-Robots-Tag", robotsHeader);
      next();
    });
    app.use(
      express.static(frontendDist, {
        setHeaders: setStaticCacheHeaders,
      }),
    );
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/wisp")) {
        next();
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      if (isFrontendAppRoute(req.path)) {
        res.sendFile(path.join(frontendDist, FRONTEND_APP_SHELL_FILE));
        return;
      }
      res.status(404).sendFile(path.join(frontendDist, "404.html"));
    });
  }

  app.use(errorHandler);

  return {
    app,
    config,
    services: {
      remoteControlSessions,
    },
  };
}

function setStaticCacheHeaders(res: express.Response, filePath: string): void {
  const cacheControl = getStaticCacheControl(filePath);
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
}

export function getStaticCacheControl(filePath: string): string | undefined {
  if (/[/\\]assets[/\\].+-[A-Za-z0-9_-]{8,}\.[^/\\]+$/.test(filePath)) {
    return "public, max-age=31536000, immutable";
  }
  if (path.extname(filePath) === ".html") return "no-cache";
  return undefined;
}

export function getFrontendRobotsHeader(urlPath: string): string | undefined {
  const isPrivatePage =
    urlPath === FRONTEND_APP_SHELL_PATH || urlPath === `/${FRONTEND_APP_SHELL_FILE}` || isFrontendAppRoute(urlPath);
  return isPrivatePage ? "noindex, nofollow, noarchive" : undefined;
}

function resolveFrontendDist(): string | null {
  const candidates = [path.resolve(process.cwd(), "../frontend/dist"), path.resolve(process.cwd(), "frontend/dist")];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? null;
}
