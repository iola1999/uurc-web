import { RemoteSignalSession } from "./signalSession";
import type { RemoteSignalSession as RemoteSignalSessionClass } from "./signalSession";
import { createRuntimeProfile } from "@uurc/shared/runtimeProfile";
import { FRONTEND_APP_SHELL_PATH, isFrontendAppRoute } from "@uurc/shared/frontendRoutes";
import { REMOTE_SESSION_HEADER, isRemoteSessionId } from "@uurc/shared/remoteSession";
import { authorizeUuRoom } from "@uurc/shared/signalGateway/authorization";
import {
  ValidationError,
  parseOptionalEventId,
  parseSignalControlRequest,
  parseSignalGatewayStartRequest,
  parseSignalSoacRequest,
} from "@uurc/shared/signalGateway/requests";
import {
  assertAllowedUuApiPath,
  parseMaybeJsonBody,
  sanitizeUuProxyHeaders,
  readBoundedText,
} from "@uurc/shared/uuProxy";

const API_BASE = "https://api.nrd.nie.163.com";
const UU_PROXY_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

interface Env {
  ASSETS: Fetcher;
  REMOTE_SIGNAL_SESSION: DurableObjectNamespace<RemoteSignalSessionClass>;
}

export { RemoteSignalSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, runtime: "cloudflare-worker" });
    }
    if (url.pathname === "/api/runtime") {
      return json(createRuntimeProfile("cloudflare-worker"));
    }
    if (url.pathname === "/api/proxy/uu" && request.method === "POST") {
      return handleUuProxy(request, env);
    }
    if (url.pathname.startsWith("/api/remote/")) {
      return handleRemoteApi(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }
    if ((request.method === "GET" || request.method === "HEAD") && isFrontendAppRoute(url.pathname)) {
      url.pathname = FRONTEND_APP_SHELL_PATH;
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleUuProxy(request: Request, env: Env): Promise<Response> {
  try {
    const parsedBody = await readJson(request);
    const body = isRecord(parsedBody) ? parsedBody : {};
    const method = typeof body.method === "string" ? body.method : "";
    const path = typeof body.path === "string" ? body.path : "";
    if (!method || !path) {
      return json({ error: "method and path are required" }, { status: 400 });
    }
    assertAllowedUuApiPath(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UU_PROXY_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: sanitizeUuProxyHeaders(body.headers),
        body: body.body === undefined ? undefined : JSON.stringify(body.body),
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error(`UU API redirect is not allowed status=${response.status}`);
      }
      const responseText = await readBoundedText(response, controller.signal);
      const contentType = response.headers.get("content-type") ?? "";
      const upstreamBody = parseMaybeJsonBody(responseText, contentType);
      const authorization = authorizeUuRoom(path, response.status, upstreamBody);
      const sessionId = request.headers.get(REMOTE_SESSION_HEADER);
      if (authorization && isRemoteSessionId(sessionId)) {
        await env.REMOTE_SIGNAL_SESSION.getByName(sessionId).authorizeRoom(authorization);
      }
      return json({
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: upstreamBody,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

async function handleRemoteApi(request: Request, env: Env): Promise<Response> {
  try {
    return await routeRemoteApi(request, env);
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, { status: 400 });
    throw error;
  }
}

async function routeRemoteApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = request.headers.get(REMOTE_SESSION_HEADER);
  if (!isRemoteSessionId(sessionId)) {
    return json({ error: "A valid remote session capability is required" }, { status: 401 });
  }
  const session = env.REMOTE_SIGNAL_SESSION.getByName(sessionId);

  if (url.pathname === "/api/remote/bootstrap") {
    return json(
      {
        error:
          "Cloudflare Worker stores room bootstrap in the browser session. Use the frontend flow to join a room first.",
      },
      { status: 404 },
    );
  }
  if (url.pathname === "/api/remote/signal/start" && request.method === "POST") {
    return json(await session.start(parseSignalGatewayStartRequest(await readJson(request))));
  }
  if (url.pathname === "/api/remote/signal/status" && request.method === "GET") {
    return json(await session.getStatus());
  }
  if (url.pathname === "/api/remote/signal/events" && request.method === "GET") {
    const after = url.searchParams.get("after");
    const afterEventId = parseOptionalEventId(after ?? undefined);
    return json(await session.getEvents(afterEventId));
  }
  if (url.pathname === "/api/remote/signal/diagnostics" && request.method === "GET") {
    return json(await session.getDiagnostics());
  }
  if (url.pathname === "/api/remote/signal" && request.method === "DELETE") {
    return json(await session.stop());
  }
  if (url.pathname === "/api/remote/signal/control" && request.method === "POST") {
    const result = await session.sendControl(parseSignalControlRequest(await readJson(request)));
    if (!result) return json({ error: "Start the signal gateway before sending control" }, { status: 409 });
    return json(result);
  }
  if (url.pathname === "/api/remote/signal/soac" && request.method === "POST") {
    const result = await session.sendSoac(parseSignalSoacRequest(await readJson(request)));
    if (!result) return json({ error: "Start the signal gateway before sending SOAC" }, { status: 409 });
    return json(result);
  }
  return json({ error: "Not found" }, { status: 404 });
}

async function readJson(request: Request): Promise<unknown> {
  const body = await readBoundedText(request, AbortSignal.timeout(30_000), 1024 * 1024);
  if (body.trim().length === 0) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new ValidationError("Expected a valid JSON payload");
  }
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
