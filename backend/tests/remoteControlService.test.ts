import { describe, expect, it, vi } from "vitest";

import { RemoteControlService } from "../src/services/remoteControlService.js";
import {
  DeferredSignalGatewayConnector,
  FakeSignalGatewayConnector,
  createRoomConfigSource,
  roomConfigFor,
} from "./fixtures/signalGateway.js";

describe("RemoteControlService", () => {
  it("returns null before a room config has been captured", async () => {
    const service = new RemoteControlService();

    await expect(service.createBootstrap()).resolves.toBeNull();
  });

  it("builds a token-safe app-compatible remote bootstrap from the latest RoomConfig", async () => {
    const service = new RemoteControlService(createRoomConfigSource());
    const bootstrap = await service.createBootstrap();

    expect(bootstrap).toMatchObject({
      status: "ready",
      strategy: "backend_signal_gateway",
      selectedSignalServer: "wss://signal-a.example",
      signalServers: ["wss://signal-a.example", "wss://signal-b.example"],
      joinContext: {
        deviceId: "desktop-1",
        forceJoin: false,
      },
      signalHeaders: {
        "X-NRD-AUTH": "<redacted room token>",
        "X-NRD-CONTROLLING": "0",
        streamer_version: "V4.6.0",
        streamer_flag: '{"sdp_flags":{"gzip_sdp":true}}',
      },
      signalEvents: ["soac", "streamer_push", "forward_setting", "device_capability"],
      soac: {
        controllerOutboundTypes: ["offer", "candidate", "restart_ice"],
        controllerInboundTypes: ["answer", "candidate", "restart_ice"],
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
      dataChannels: {
        control: "CONTROL_DATA_CHANNEL",
        text: "TEXT_DATA_CHANNEL",
      },
      connectOptions: {
        appClientVersion: "4.39.1",
        clientTypes: {
          Client_ANDROID: 2,
        },
        captureParams: {
          fields: expect.arrayContaining([
            { tag: 1, name: "fps", defaultValue: "FPS_UNKNOWN" },
            { tag: 2, name: "video_quality", defaultValue: "VideoQuality_UNKNOWN" },
          ]),
          fpsValues: {
            FPS_UNKNOWN: 0,
            FPS_60: 2,
          },
          staticDefaults: {
            fps: "FPS_UNKNOWN",
            videoQuality: "VideoQuality_UNKNOWN",
          },
        },
        defaultFeatureFlags: {
          ff_capture_setting: 2,
          ff_clipboard: 3,
        },
      },
      input: {
        supportedBuilders: [
          "desktop_mouse",
          "desktop_keyboard",
          "ime_text",
          "ime_control",
          "mumu_system_key",
          "mumu_touch",
        ],
        imeControlCodes: {
          BACKSPACE: 14,
          ENTER: 28,
          HIDESELF: 100001,
        },
        mumuSystemKeyCodes: {
          BACK: 158,
          HOME: 172,
          MENU: 580,
        },
        touchSlots: [26, 27, 28, 29, 30, 31],
      },
    });
    expect(JSON.stringify(bootstrap)).not.toContain("room-secret-token");
  });

  it("starts a backend signal gateway with raw app-compatible headers but returns only redacted status", async () => {
    const connector = new FakeSignalGatewayConnector();
    const service = new RemoteControlService(createRoomConfigSource(), connector);

    const status = await service.startSignalGateway();

    expect(connector.connectCalls).toHaveLength(1);
    expect(connector.connectCalls[0]).toMatchObject({
      signalServer: "wss://signal-a.example",
      headers: {
        "X-NRD-AUTH": "room-secret-token",
        "X-NRD-CONTROLLING": "0",
        streamer_version: "V4.6.0",
        streamer_flag: '{"sdp_flags":{"gzip_sdp":true}}',
      },
      timeoutMs: 12000,
      reconnectDelayMs: 1500,
    });
    expect(status).toMatchObject({
      status: "connected",
      strategy: "backend_signal_gateway",
      selectedSignalServer: "wss://signal-a.example",
      signalHeaders: {
        "X-NRD-AUTH": "<redacted room token>",
      },
      signalControl: {
        event: "control",
        ackTimeoutMs: 10000,
      },
      connectionId: "fake-signal-1",
    });
    expect(JSON.stringify(status)).not.toContain("room-secret-token");
  });

  it("applies the streamerVersion override to the signal handshake headers", async () => {
    const connector = new FakeSignalGatewayConnector();
    const service = new RemoteControlService(createRoomConfigSource(), connector);

    await service.startSignalGateway({ streamerVersion: "V4.5.0" });

    expect(connector.connectCalls[0]).toMatchObject({
      headers: {
        "X-NRD-AUTH": "room-secret-token",
        "X-NRD-CONTROLLING": "0",
        streamer_version: "V4.5.0",
        streamer_flag: '{"sdp_flags":{"gzip_sdp":true}}',
      },
    });
  });

  it("can start the signal gateway from a selected signal server index", async () => {
    const connector = new FakeSignalGatewayConnector((options) =>
      options.signalServer === "wss://signal-b.example" ? new Error("selected gateway unavailable") : undefined,
    );
    const service = new RemoteControlService(createRoomConfigSource(), connector);

    const status = await service.startSignalGateway({ signalServerIndex: 1 });

    expect(connector.connectCalls.map((call) => call.signalServer)).toEqual([
      "wss://signal-b.example",
      "wss://signal-a.example",
    ]);
    expect(status).toMatchObject({
      status: "connected",
      selectedSignalServer: "wss://signal-a.example",
    });
  });

  it("can start the signal gateway with plain-SDP capability headers", async () => {
    const connector = new FakeSignalGatewayConnector();
    const service = new RemoteControlService(createRoomConfigSource(), connector);

    const status = await service.startSignalGateway({ gzipSdp: false });

    expect(connector.connectCalls[0].headers.streamer_flag).toBe('{"sdp_flags":{"gzip_sdp":false}}');
    expect(status?.signalHeaders.streamer_flag).toBe('{"sdp_flags":{"gzip_sdp":false}}');
  });

  it("falls back to the next App signal server when the primary socket cannot connect", async () => {
    const connector = new FakeSignalGatewayConnector((options) =>
      options.signalServer === "wss://signal-a.example" ? new Error("primary signal down") : undefined,
    );
    const service = new RemoteControlService(createRoomConfigSource(), connector);

    const status = await service.startSignalGateway();

    expect(connector.connectCalls.map((call) => call.signalServer)).toEqual([
      "wss://signal-a.example",
      "wss://signal-b.example",
    ]);
    expect(status).toMatchObject({
      status: "connected",
      selectedSignalServer: "wss://signal-b.example",
      signalServers: ["wss://signal-a.example", "wss://signal-b.example"],
      connectionId: "fake-signal-1",
    });
  });

  it("records signal gateway connector failures without leaking the room token", async () => {
    const connector = new FakeSignalGatewayConnector(new Error("connect failed with auth room-secret-token"));
    const service = new RemoteControlService(createRoomConfigSource(), connector);

    const status = await service.startSignalGateway();

    expect(status).toMatchObject({
      status: "error",
      selectedSignalServer: "wss://signal-a.example",
      error: "connect failed with auth <redacted room token>",
    });
    expect(JSON.stringify(status)).not.toContain("room-secret-token");
  });

  it("stops the current signal gateway connection and clears the App room occupancy", async () => {
    const calls: Array<{ deviceId: string }> = [];
    const connector = new FakeSignalGatewayConnector();
    const service = new RemoteControlService(
      createRoomConfigSource({
        clearByDevice: async (input) => {
          calls.push(input);
          return {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            body: {
              code: 0,
              msg: "ok",
              dataKeys: ["ignored_token_like_value"],
            },
          };
        },
      }),
      connector,
    );
    await service.startSignalGateway();

    const status = await service.stopSignalGateway();

    expect(connector.connections[0].closed).toBe(true);
    expect(calls).toEqual([{ deviceId: "desktop-1" }]);
    expect(status).toMatchObject({
      status: "closed",
      selectedSignalServer: "wss://signal-a.example",
      roomClear: {
        status: 200,
        body: {
          code: 0,
          msg: "ok",
          dataKeys: ["ignored_token_like_value"],
        },
      },
    });
    expect(JSON.stringify(status)).not.toContain("do-not-return");
  });

  it("keeps a stop request authoritative when an older connection finishes late", async () => {
    const connector = new DeferredSignalGatewayConnector();
    const service = new RemoteControlService(createRoomConfigSource(), connector);
    const starting = service.startSignalGateway();
    await vi.waitFor(() => expect(connector.connectCalls).toHaveLength(1));

    await service.stopSignalGateway();
    const lateConnection = connector.resolve(0, "late-connection");
    await starting;

    expect(lateConnection.closed).toBe(true);
    expect(service.getSignalGatewayStatus().status).toBe("closed");
  });

  it("lets the newest concurrent start own the active connection", async () => {
    const connector = new DeferredSignalGatewayConnector();
    const concurrentService = new RemoteControlService(undefined, connector);
    const olderStart = concurrentService.startSignalGateway({ roomConfig: roomConfigFor("wss://signal-a.example") });
    await vi.waitFor(() => expect(connector.connectCalls).toHaveLength(1));
    const newerStart = concurrentService.startSignalGateway({ roomConfig: roomConfigFor("wss://signal-b.example") });
    await vi.waitFor(() => expect(connector.connectCalls).toHaveLength(2));

    const newerConnection = connector.resolve(1, "newer-connection");
    await newerStart;
    const olderConnection = connector.resolve(0, "older-connection");
    await olderStart;

    expect(olderConnection.closed).toBe(true);
    expect(newerConnection.closed).toBe(false);
    expect(concurrentService.getSignalGatewayStatus()).toMatchObject({
      status: "connected",
      selectedSignalServer: "wss://signal-b.example",
      connectionId: "newer-connection",
    });
  });

  it("keeps the active connection authoritative when a later start has no room config", async () => {
    const connector = new FakeSignalGatewayConnector();
    const service = new RemoteControlService(undefined, connector);
    await service.startSignalGateway({ roomConfig: roomConfigFor("wss://signal-a.example") });

    await expect(service.startSignalGateway()).resolves.toBeNull();

    expect(connector.connections[0].closed).toBe(false);
    connector.connectCalls[0].onConnectionStateChange?.({ status: "closed", reason: "remote disconnect" });
    expect(service.getSignalGatewayStatus()).toMatchObject({
      status: "closed",
      error: "remote disconnect",
    });
  });

  it("propagates an upstream disconnect into the gateway status", async () => {
    const connector = new FakeSignalGatewayConnector();
    const service = new RemoteControlService(createRoomConfigSource(), connector);
    await service.startSignalGateway();

    connector.connectCalls[0].onConnectionStateChange?.({
      status: "closed",
      reason: "transport closed room-secret-token",
    });

    expect(service.getSignalGatewayStatus()).toMatchObject({
      status: "closed",
      error: "transport closed <redacted room token>",
    });
    await expect(service.sendSignalControl({ appControlId: "app-control-1" })).resolves.toBeNull();
  });
});
