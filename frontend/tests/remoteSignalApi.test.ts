import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_SESSION_HEADER } from "@uurc/shared/remoteSession";

import {
  getRemoteSignalDiagnostics,
  getRemoteSignalEvents,
  sendRemoteSignalControl,
  sendRemoteSignalSoac,
} from "../src/api/remoteSignalApi.js";
import { getRuntimeProfile } from "../src/api/runtimeApi.js";
import { getRemoteSessionId } from "../src/api/remoteSession.js";

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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
