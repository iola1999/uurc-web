import { expect } from "vitest";

import { analyzeRemoteSignalReadiness } from "@uurc/shared/streamer/readiness";

export const appBackend = {
  requestLog: [] as Array<{ method: string; path: string; body: unknown; transportPath?: string }>,
  currentRemoteSignalEvents: [] as unknown[],
  joinRoomFailure: false,
  lastControlIceId: "",
  currentControlForceRelay: false,
  currentParticipants: [] as Array<Record<string, unknown>>,
  currentAssistControlMode: "by_password",
  currentAssistPlatformFields: {} as Record<string, number>,
  assistCodeRequiresConfirmation: false,
  currentSignalServers: ["wss://signal.example"],
  signalStartError: false,
  remoteTrackPlan: [] as Array<{ id: string; kind: "audio" | "video" }>,
};

export async function handleFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (path === "/api/proxy/uu" && method === "POST") {
    return handleUuProxyFetch(body);
  }

  appBackend.requestLog.push({ method, path, body });

  if (path === "/api/runtime") {
    return jsonResponse({
      ok: true,
      runtime: "node",
      uuProxyPath: "/api/proxy/uu",
      signalGateway: "node-socket-io",
      remoteApiBase: "/api/remote",
      wispProxy: false,
    });
  }

  if (path === "/api/remote/signal/start" && method === "POST") {
    const joinContext = body.joinContext as { kind?: string; deviceId?: string } | undefined;
    const remoteAssistance = joinContext?.kind === "remote_assistance";
    expect(body).toMatchObject({ gzipSdp: false });
    expect(body).toHaveProperty("roomConfig.token", remoteAssistance ? "assist-room-token" : "room-token-1");
    expect(body).toHaveProperty("joinContext.deviceId", remoteAssistance ? "982123456" : "desktop-1");
    if (appBackend.signalStartError) {
      return jsonResponse({
        status: "error",
        strategy: "backend_signal_gateway",
        selectedSignalServer: appBackend.currentSignalServers[0],
        signalServers: appBackend.currentSignalServers,
        signalHeaders: {
          "X-NRD-AUTH": "<redacted room token>",
          "X-NRD-CONTROLLING": "0",
          streamer_version: "V4.6.0",
          streamer_flag: '{"sdp_flags":{"gzip_sdp":false}}',
        },
        signalControl: {
          socketEvents: {
            control: "control",
            leave: "leave",
            bmsgPush: "bmsg_push",
            publisherDisconnect: "publisher_disconnect",
          },
          event: "control",
          payloadKeys: ["app_control_id", "app_data", "streamer_data"],
          ackTimeoutMs: 10000,
        },
        connectionId: "web-test-signal-1",
        startedAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        error: "websocket error",
      });
    }
    const signalServerIndex = typeof body.signalServerIndex === "number" ? body.signalServerIndex : 0;
    return jsonResponse({
      status: "connected",
      strategy: "backend_signal_gateway",
      selectedSignalServer: appBackend.currentSignalServers[signalServerIndex] ?? appBackend.currentSignalServers[0],
      signalServers: appBackend.currentSignalServers,
      signalHeaders: {
        "X-NRD-AUTH": "<redacted room token>",
        "X-NRD-CONTROLLING": "0",
        streamer_version: "V4.6.0",
        streamer_flag: '{"sdp_flags":{"gzip_sdp":false}}',
      },
      signalControl: {
        socketEvents: {
          control: "control",
          leave: "leave",
          bmsgPush: "bmsg_push",
          publisherDisconnect: "publisher_disconnect",
        },
        event: "control",
        payloadKeys: ["app_control_id", "app_data", "streamer_data"],
        ackTimeoutMs: 10000,
      },
      connectionId: "web-test-signal-1",
      startedAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
  }

  if (path === "/api/remote/signal/control" && method === "POST") {
    expect(body.appControlId).toEqual(expect.any(String));
    expect(body.appDataBase64).toEqual(expect.any(String));
    expect(body.streamerData).toContain('"control_id"');
    const streamerData = JSON.parse(body.streamerData);
    expect(streamerData.device_capability.display_info[0]).toMatchObject({
      fps: 60,
      type: 0,
      hdr: -1,
    });
    expect(streamerData.device_capability.video_codec_capability[0]).toMatchObject({
      video_codec: 1,
      width: 3840,
      height: 2160,
    });
    expect(streamerData.device_capability.ice_id).toBe("");
    appBackend.lastControlIceId = "control-ice-1";
    return jsonResponse({
      event: "control",
      ackStatus: "success",
      ack: [],
      control: {
        ackStatus: "success",
        result: {
          clientId: "controlled-1",
          iceId: appBackend.lastControlIceId,
          forceRelay: appBackend.currentControlForceRelay,
          autoSwitchNetwork: true,
          forceAutoSwitchPacketLoss: 18,
          forceAutoSwitchLatency: 160,
          possibleAutoSwitchPacketLoss: 8,
          possibleAutoSwitchLatency: 90,
          iceServers: [
            {
              urls: "stun:stun.example:3478",
            },
          ],
        },
      },
      emittedAt: "2026-05-14T00:00:00.000Z",
      ackReceivedAt: "2026-05-14T00:00:00.050Z",
    });
  }

  if (path === "/api/remote/signal/soac" && method === "POST") {
    expect(body).toMatchObject({
      type: "offer",
      clientId: "controlled-1",
      iceId: appBackend.lastControlIceId,
      sdp: "v=0 browser offer",
      gzipSdp: false,
      iceNetworkType: 3,
    });
    expect(body.appControlId).toEqual(expect.any(String));
    return jsonResponse({
      event: "soac",
      payload: body,
      emittedAt: "2026-05-14T00:00:00.100Z",
    });
  }

  if (path.startsWith("/api/remote/signal/events")) {
    const after = Number.parseInt(new URL(path, "https://uurc.test").searchParams.get("after") ?? "0", 10);
    return jsonResponse(
      appBackend.currentRemoteSignalEvents.filter((event) => {
        const id = (event as { id?: unknown }).id;
        return typeof id === "number" && id > after;
      }),
    );
  }

  if (path === "/api/remote/signal/diagnostics") {
    return jsonResponse(
      analyzeRemoteSignalReadiness({
        events: appBackend.currentRemoteSignalEvents,
        signalStatus: {
          status: "connected",
          strategy: "backend_signal_gateway",
          selectedSignalServer: "wss://signal.example",
          signalServers: ["wss://signal.example"],
          signalHeaders: {
            "X-NRD-AUTH": "<redacted room token>",
          },
          signalControl: {
            socketEvents: {
              control: "control",
              leave: "leave",
              bmsgPush: "bmsg_push",
              publisherDisconnect: "publisher_disconnect",
            },
            event: "control",
            payloadKeys: ["app_control_id", "app_data", "streamer_data"],
            ackTimeoutMs: 10000,
          },
          connectionId: "web-test-signal-1",
          startedAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
        },
      }),
    );
  }

  if (path === "/api/remote/signal" && method === "DELETE") {
    return jsonResponse({
      status: "closed",
      strategy: "backend_signal_gateway",
      selectedSignalServer: "wss://signal.example",
      signalServers: ["wss://signal.example"],
      signalHeaders: {
        "X-NRD-AUTH": "<redacted room token>",
      },
      signalControl: {
        socketEvents: {
          control: "control",
          leave: "leave",
          bmsgPush: "bmsg_push",
          publisherDisconnect: "publisher_disconnect",
        },
        event: "control",
        payloadKeys: ["app_control_id", "app_data", "streamer_data"],
        ackTimeoutMs: 10000,
      },
      startedAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:01.000Z",
      roomClear: {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        body: {
          code: 0,
          msg: "ok",
        },
      },
    });
  }

  throw new Error(`Unhandled fetch ${method} ${path}`);
}

export async function handleUuProxyFetch(body: unknown): Promise<Response> {
  const request = body as { method: string; path: string; body?: unknown; headers?: Record<string, string> };
  appBackend.requestLog.push({
    method: request.method,
    path: request.path,
    body: request.body ?? null,
    transportPath: "/api/proxy/uu",
  });
  expect(request.headers?.["X-Param-SIGN"]).toEqual(expect.any(String));

  if (request.path === "/api/v1/device/android/init" && request.method === "POST") {
    expect(request.body).toMatchObject({ client_id: expect.stringMatching(/^uurc-web-/), model: "Pixel 8" });
    return jsonResponse(uuResponse({ code: 0, data: { device_id: "web-device-1" } }));
  }

  if (request.path === "/api/v1/security/mobile/code" && request.method === "POST") {
    expect(request.body).toEqual({ country_code: "86", mobile: "13800000000", type: "login" });
    return jsonResponse(uuResponse({ code: 0, data: { ok: true } }));
  }

  if (request.path === "/api/v1/login/by_mobile" && request.method === "POST") {
    expect(request.body).toEqual({ country_code: "86", mobile: "13800000000", code: "123456" });
    return jsonResponse(
      uuResponse({
        code: 0,
        data: {
          user_id: "user-1",
          nickname: "Local User",
          token: "header.payload.signature",
        },
      }),
    );
  }

  if (request.path === "/api/v1/device/groups/of/my" && request.method === "GET") {
    return jsonResponse(
      uuResponse({
        code: 0,
        data: {
          desktop_devices: [
            {
              device_id: "desktop-1",
              alias: "Office Mac",
              controllable: true,
              status: "CONNECTED",
              app_flag: { control_mode: null },
              participants_info: appBackend.currentParticipants,
            },
          ],
          mobile_devices: [],
          tv_devices: [],
        },
      }),
    );
  }

  if (request.path === "/api/v1/room/join/by_device/desktop-1" && request.method === "POST") {
    expect(request.body).toMatchObject({ force_join: expect.any(Boolean) });
    if (appBackend.joinRoomFailure) {
      return jsonResponse(
        uuResponse(
          {
            code: 2002,
            msg: "被控端正在被远控中，无法发起连接",
          },
          400,
        ),
      );
    }
    return jsonResponse(
      uuResponse({
        code: 0,
        data: {
          room_config: {
            token: "room-token-1",
            signal_servers: appBackend.currentSignalServers,
            timeout: 12000,
            signal_reconnect_delay: 1500,
            report_token: "report-token-1",
            app_data: "{}",
          },
        },
      }),
    );
  }

  if (request.path === "/api/v1/room/clear/by_device/desktop-1" && request.method === "POST") {
    return jsonResponse(uuResponse({ code: 0, msg: "ok" }));
  }

  if (request.path === "/api/v2/room/share/control_mode" && request.method === "POST") {
    expect(request.body).toEqual({ connect_id: "982123456" });
    return jsonResponse(
      uuResponse({
        code: 0,
        data: {
          can_remote_control: true,
          control_mode: appBackend.currentAssistControlMode,
        },
      }),
    );
  }

  if (request.path === "/api/v2/room/join/share/by_code" && request.method === "POST") {
    expect(request.body).toEqual({ connect_id: "982123456", connect_code: "L6026CCD" });
    if (appBackend.assistCodeRequiresConfirmation) {
      return jsonResponse(
        uuResponse({
          code: 0x470,
          msg: "confirmation required",
          data: { control_id: "assist-control-1" },
        }),
      );
    }
    return jsonResponse(
      uuResponse({
        code: 0,
        data: {
          control_id: "assist-control-1",
          device_name: "Partner PC",
          ...appBackend.currentAssistPlatformFields,
          room_config: {
            token: "assist-room-token",
            signaling_server: "wss://assist-primary.example",
            signaling_list: ["wss://assist-primary.example"],
            ws_connect_timeout_ms: 12000,
            streamer_retry_delta_ms: 900,
            report_token: "assist-report-token",
            report_url: "https://report.example/qos",
          },
        },
      }),
    );
  }

  if (request.path === "/api/v2/room/join/share/by_confirmation" && request.method === "POST") {
    expect(request.body).toMatchObject({ connect_id: "982123456" });
    return jsonResponse(
      uuResponse({
        code: 0,
        data: {
          control_id: "assist-control-1",
          device_name: "Partner PC",
          ...appBackend.currentAssistPlatformFields,
          room_config: {
            token: "assist-room-token",
            signaling_server: "wss://assist-primary.example",
            ws_connect_timeout_ms: 12000,
            streamer_retry_delta_ms: 900,
          },
        },
      }),
    );
  }

  if (request.path === "/api/v2/room/share/cancel_remote_assist" && request.method === "POST") {
    expect(request.body).toEqual({ connect_id: "982123456" });
    return jsonResponse(uuResponse({ code: 0, msg: "ok" }));
  }

  throw new Error(`Unhandled UU proxy ${request.method} ${request.path}`);
}

export function uuResponse(body: unknown, status = 200) {
  return {
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    headers: { "content-type": "application/json" },
    body,
  };
}

export function uuCalls(path: string) {
  return appBackend.requestLog.filter((call) => call.path === path && call.transportPath === "/api/proxy/uu");
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
