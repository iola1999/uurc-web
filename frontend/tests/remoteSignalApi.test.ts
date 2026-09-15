import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_SESSION_HEADER } from "@uurc/shared/remoteSession";

import type { RemoteSignalGatewayStatus } from "@uurc/shared/signalGateway/model";

import {
  getRemoteSignalDiagnostics,
  getRemoteSignalEvents,
  resetSignalChannelDispatch,
  sendRemoteSignalControl,
  sendRemoteSignalSoac,
  setSignalChannelPreference,
  startRemoteSignalGateway,
  stopRemoteSignalGateway,
} from "../src/api/remoteSignalApi.js";
import { getRuntimeProfile } from "../src/api/runtimeApi.js";
import { getRemoteSessionId } from "../src/api/remoteSession.js";

const bridge = vi.hoisted(() => ({
  peek: vi.fn(),
  detect: vi.fn(),
  warmUp: vi.fn(),
  setHeaders: vi.fn(async () => {}),
  clearHeaders: vi.fn(async () => {}),
}));

vi.mock("../src/direct/extensionBridge.js", () => ({
  peekDirectSignalExtension: bridge.peek,
  detectDirectSignalExtension: bridge.detect,
  warmUpDirectSignalExtensionDetection: bridge.warmUp,
  setExtensionSignalHeaders: bridge.setHeaders,
  clearExtensionSignalHeaders: bridge.clearHeaders,
}));

const direct = vi.hoisted(() => ({
  instances: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  startResult: "connected" as "connected" | "error" | "throw",
}));

vi.mock("../src/direct/directSignalClient.js", () => {
  class DirectSignalClientMock {
    start = vi.fn(async (): Promise<RemoteSignalGatewayStatus> => {
      if (direct.startResult === "throw") throw new Error("direct start blew up");
      return {
        status: direct.startResult === "connected" ? "connected" : "error",
        strategy: "browser_direct_signal",
        signalServers: [],
        signalHeaders: {},
        signalControl: {
          socketEvents: {},
          event: "control",
          payloadKeys: [],
          payloadTypes: {},
          wireArgumentOrder: [],
          streamerDataJsonKeys: [],
          ackTimeoutMs: 10_000,
        },
        updatedAt: new Date().toISOString(),
        error: direct.startResult === "error" ? "synthetic direct failure" : undefined,
      } as RemoteSignalGatewayStatus;
    });
    stop = vi.fn(async () => ({ status: "closed", strategy: "browser_direct_signal" }) as unknown);
    getEvents = vi.fn(() => [{ id: 7, direction: "inbound", event: "soac", receivedAt: "", payload: null }]);
    getDiagnostics = vi.fn(() => ({ gatewayStatus: "connected" }));
    sendControl = vi.fn(async () => ({ event: "control", ack: ["success"], ackStatus: "success" }));
    sendSoac = vi.fn(async () => ({ event: "soac", payload: {}, emittedAt: "" }));

    constructor() {
      direct.instances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
    }
  }
  return { DirectSignalClient: DirectSignalClientMock };
});

vi.mock("../src/uu/roomApi.js", () => ({
  getRemoteSignalStartContext: () => ({
    roomConfig: { token: "synthetic-room-token", signalServers: ["wss://sig-a.example/"] },
    joinContext: { kind: "owned_device", deviceId: "device-1", forceJoin: false, occupiedAtJoin: false },
  }),
}));

// 分发层持有模块级状态,每个用例结束后复位,避免直连客户端泄漏进 HTTP 路径用例
afterEach(() => {
  resetSignalChannelDispatch();
});

describe("frontend remote signal API", () => {
  beforeEach(() => {
    window.sessionStorage.setItem("uurc.remoteSessionId", "0123456789abcdef0123456789abcdef");
    window.localStorage.setItem(
      "uurc.loginState",
      JSON.stringify({
        token: "header.payload.signature",
        userId: "user-1",
        clientId: "client-1",
        deviceId: "web-device-1",
      }),
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("calls backend signal event, control, and SOAC routes", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ path: String(input), init });
        if (String(input) === "/api/remote/signal/events") {
          return jsonResponse([{ id: 1, direction: "inbound", event: "soac", receivedAt: "now", payload: [] }]);
        }
        if (String(input) === "/api/runtime") {
          return jsonResponse({
            ok: true,
            runtime: "node",
            uuProxyPath: "/api/proxy/uu",
            signalGateway: "node-socket-io",
            remoteApiBase: "/api/remote",
            wispProxy: false,
          });
        }
        if (String(input) === "/api/remote/signal/diagnostics") {
          return jsonResponse({
            stage: "answer_missing",
            blocker: "answer_missing",
            checks: {
              signalGatewayConnected: true,
              controlAckReceived: true,
              offerSent: true,
              beControlledReceived: true,
              answerReceived: false,
            },
            counts: {
              inbound: 2,
              outbound: 1,
            },
          });
        }
        if (String(input) === "/api/remote/signal/control") {
          return jsonResponse({
            event: "control",
            ack: [],
            control: { ackStatus: "success" },
            emittedAt: "now",
            ackReceivedAt: "now",
          });
        }
        if (String(input) === "/api/remote/signal/soac") {
          return jsonResponse({ event: "soac", payload: {}, emittedAt: "now" });
        }
        if (String(input) === "/api/proxy/uu") {
          return jsonResponse({
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            body: { code: 0 },
          });
        }
        return jsonResponse({});
      }),
    );

    await expect(getRuntimeProfile()).resolves.toMatchObject({
      runtime: "node",
      uuProxyPath: "/api/proxy/uu",
      remoteApiBase: "/api/remote",
    });
    await expect(getRemoteSignalEvents()).resolves.toHaveLength(1);
    await expect(getRemoteSignalDiagnostics()).resolves.toMatchObject({
      stage: "answer_missing",
      blocker: "answer_missing",
    });
    await expect(
      sendRemoteSignalControl({
        appControlId: "control-1",
        appDataBase64: "AQID",
        streamerData: "{}",
      }),
    ).resolves.toMatchObject({ event: "control" });
    await expect(
      sendRemoteSignalSoac({
        type: "offer",
        appControlId: "control-1",
        sdp: "v=0",
      }),
    ).resolves.toMatchObject({ event: "soac" });
    expect(
      calls.map((call) => [
        call.path,
        call.init?.method ?? "GET",
        call.init?.body ? JSON.parse(String(call.init.body)) : null,
      ]),
    ).toEqual([
      ["/api/runtime", "GET", null],
      ["/api/remote/signal/events", "GET", null],
      ["/api/remote/signal/diagnostics", "GET", null],
      [
        "/api/remote/signal/control",
        "POST",
        {
          appControlId: "control-1",
          appDataBase64: "AQID",
          streamerData: "{}",
        },
      ],
      [
        "/api/remote/signal/soac",
        "POST",
        {
          type: "offer",
          appControlId: "control-1",
          sdp: "v=0",
        },
      ],
    ]);
    for (const call of calls.filter((item) => item.path.startsWith("/api/remote/signal"))) {
      expect(new Headers(call.init?.headers).get(REMOTE_SESSION_HEADER)).toBe(getRemoteSessionId());
    }
  });
});

const httpCalls: Array<{ path: string; method: string; body?: string }> = [];
const gatewayStartStatus = { status: "connected", strategy: "backend_signal_gateway" };
const gatewayStopStatus = { status: "closed", strategy: "backend_signal_gateway" };
const AVAILABLE = { available: true, version: "0.1.0", reason: "" };

describe("remoteSignalApi channel dispatch", () => {
  beforeEach(() => {
    resetSignalChannelDispatch();
    direct.instances = [];
    direct.startResult = "connected";
    httpCalls.length = 0;
    bridge.peek.mockReset().mockReturnValue(null);
    bridge.detect.mockReset().mockResolvedValue(AVAILABLE);
    bridge.warmUp.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = String(input);
        httpCalls.push({
          path,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return jsonResponse(path.includes("/start") ? gatewayStartStatus : gatewayStopStatus);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts through the gateway and warms up detection when no cached probe exists", async () => {
    const status = await startRemoteSignalGateway({ gzipSdp: true });

    expect(status.strategy).toBe("backend_signal_gateway");
    expect(direct.instances).toHaveLength(0);
    expect(bridge.warmUp).toHaveBeenCalledOnce();
    expect(httpCalls).toEqual([expect.objectContaining({ path: "/api/remote/signal/start", method: "POST" })]);
    // 房间上下文并入请求体,与网关授权校验保持一致
    expect(httpCalls[0].body).toContain("synthetic-room-token");
  });

  it("routes start/events/diagnostics/control/soac to the direct client when the extension is available", async () => {
    bridge.peek.mockReturnValue(AVAILABLE);

    const status = await startRemoteSignalGateway({});
    expect(status.strategy).toBe("browser_direct_signal");
    expect(direct.instances).toHaveLength(1);
    expect(httpCalls).toHaveLength(0);

    const client = direct.instances[0];
    expect(await getRemoteSignalEvents(3)).toEqual(client.getEvents.mock.results[0].value);
    expect(client.getEvents).toHaveBeenCalledWith(3);
    expect((await getRemoteSignalDiagnostics()).gatewayStatus).toBe("connected");
    expect((await sendRemoteSignalControl({ appControlId: "ac-1" })).ackStatus).toBe("success");
    expect((await sendRemoteSignalSoac({ type: "candidate" })).event).toBe("soac");
    expect(httpCalls).toHaveLength(0);
  });

  it("falls back to the gateway in auto mode and stops retrying direct after repeated failures", async () => {
    bridge.peek.mockReturnValue(AVAILABLE);
    direct.startResult = "error";

    const first = await startRemoteSignalGateway({});
    expect(first.strategy).toBe("backend_signal_gateway");
    expect(direct.instances).toHaveLength(1);

    const second = await startRemoteSignalGateway({});
    expect(second.strategy).toBe("backend_signal_gateway");
    expect(direct.instances).toHaveLength(2);

    // 连续两次直连失败后粘滞回退,不再构造直连客户端
    const third = await startRemoteSignalGateway({});
    expect(third.strategy).toBe("backend_signal_gateway");
    expect(direct.instances).toHaveLength(2);
    expect(httpCalls.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(3);
  });

  it("honors the gateway preference and the forced-relay route mode even with an available extension", async () => {
    bridge.peek.mockReturnValue(AVAILABLE);

    setSignalChannelPreference({ channelMode: "gateway", routeMode: "auto" });
    await startRemoteSignalGateway({});
    expect(direct.instances).toHaveLength(0);

    setSignalChannelPreference({ channelMode: "auto", routeMode: "relay" });
    await startRemoteSignalGateway({});
    expect(direct.instances).toHaveLength(0);
    expect(httpCalls.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(2);
  });

  it("surfaces the detection reason when explicit direct mode finds no extension", async () => {
    setSignalChannelPreference({ channelMode: "direct", routeMode: "auto" });
    bridge.peek.mockReturnValue(null);
    bridge.detect.mockResolvedValue({ available: false, reason: "未检测到 Direct Signal 扩展" });

    await expect(startRemoteSignalGateway({})).rejects.toThrow("未检测到 Direct Signal 扩展");
    expect(httpCalls).toHaveLength(0);
  });

  it("returns the direct error status instead of falling back in explicit direct mode", async () => {
    setSignalChannelPreference({ channelMode: "direct", routeMode: "auto" });
    bridge.peek.mockReturnValue(AVAILABLE);
    direct.startResult = "error";

    const status = await startRemoteSignalGateway({});
    expect(status.status).toBe("error");
    expect(status.strategy).toBe("browser_direct_signal");
    expect(httpCalls).toHaveLength(0);
  });

  it("stops both paths on stop and prefers the direct status", async () => {
    bridge.peek.mockReturnValue(AVAILABLE);
    await startRemoteSignalGateway({});

    const status = await stopRemoteSignalGateway();

    expect(direct.instances[0].stop).toHaveBeenCalledOnce();
    expect(httpCalls).toContainEqual(expect.objectContaining({ path: "/api/remote/signal", method: "DELETE" }));
    expect((status as unknown as { strategy: string }).strategy).toBe("browser_direct_signal");
  });

  it("stops through HTTP only when no direct client is active", async () => {
    const status = await stopRemoteSignalGateway();
    expect((status as unknown as { strategy: string }).strategy).toBe("backend_signal_gateway");
    expect(httpCalls).toEqual([expect.objectContaining({ path: "/api/remote/signal", method: "DELETE" })]);
  });

  it("throws the gateway-parity 409 messages when the direct socket is not connected", async () => {
    bridge.peek.mockReturnValue(AVAILABLE);
    await startRemoteSignalGateway({});
    direct.instances[0].sendControl.mockResolvedValueOnce(null);
    direct.instances[0].sendSoac.mockResolvedValueOnce(null);

    await expect(sendRemoteSignalControl({ appControlId: "ac-1" })).rejects.toThrow(
      "Start the signal gateway before sending control",
    );
    await expect(sendRemoteSignalSoac({ type: "candidate" })).rejects.toThrow(
      "Start the signal gateway before sending SOAC",
    );
  });

  it("stops the previous direct client before starting a new one", async () => {
    bridge.peek.mockReturnValue(AVAILABLE);
    await startRemoteSignalGateway({});
    await startRemoteSignalGateway({});

    expect(direct.instances).toHaveLength(2);
    expect(direct.instances[0].stop).toHaveBeenCalledOnce();
    expect(direct.instances[0].stop.mock.invocationCallOrder[0]).toBeLessThan(
      direct.instances[1].start.mock.invocationCallOrder[0],
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
