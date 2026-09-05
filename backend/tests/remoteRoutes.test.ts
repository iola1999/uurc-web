import request from "supertest";
import { describe, expect, it } from "vitest";
import { REMOTE_SESSION_HEADER } from "@uurc/shared/remoteSession";
import { STREAMER_ICE_NETWORK_TYPES } from "@uurc/shared/streamer/signalSoac";

import { createApp as createUnregisteredApp, type AppOverrides } from "../src/app.js";
import type { SignalGatewayConnectOptions, SignalGatewayConnector } from "../src/services/signalGateway.js";

describe("remote routes", () => {
  it("rejects caller-supplied rooms without contacting their signal server", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app, services } = createUnregisteredApp({ signalGatewayConnector: connector });
    await request(app).post("/api/remote/signal/start").set(remoteSessionHeader()).send(startPayload()).expect(403);
    await request(app).get("/api/remote/signal/status").set(remoteSessionHeader()).expect(200);
    expect(connector.connectCalls).toHaveLength(0);
    expect(services.remoteControlSessions.size).toBe(0);
  });
  it("requires an opaque browser session capability", async () => {
    const { app } = createApp();

    await request(app).get("/api/remote/signal/status").expect(401);
    await request(app).get("/api/remote/signal/status").set(REMOTE_SESSION_HEADER, "short").expect(401);
  });

  it("returns 404 until a room has been joined", async () => {
    const { app } = createApp();

    await request(app).get("/api/remote/bootstrap").set(remoteSessionHeader()).expect(404);
  });

  it("does not read persisted room state for backend bootstrap", async () => {
    const { app } = createApp();

    await request(app).get("/api/remote/bootstrap").set(remoteSessionHeader()).expect(404);
  });

  it("starts, reports, and stops the backend signal gateway via token-safe routes", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app } = createApp({ signalGatewayConnector: connector });

    const start = await request(app)
      .post("/api/remote/signal/start")
      .set(remoteSessionHeader())
      .send(startPayload())
      .expect(200);

    expect(connector.connectCalls[0].headers["X-NRD-AUTH"]).toBe("room-secret-token");
    expect(start.body.status).toBe("connected");
    expect(JSON.stringify(start.body)).not.toContain("room-secret-token");

    const status = await request(app).get("/api/remote/signal/status").set(remoteSessionHeader()).expect(200);
    expect(status.body.status).toBe(start.body.status);
    expect(JSON.stringify(status.body)).not.toContain("room-secret-token");

    const stopped = await request(app).delete("/api/remote/signal").set(remoteSessionHeader()).expect(200);
    expect(stopped.body.status).toBe("closed");
    expect(JSON.stringify(stopped.body)).not.toContain("room-secret-token");
  });

  it("bridges signal events and App control acks through token-safe routes", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app } = createApp({ signalGatewayConnector: connector });
    await request(app).post("/api/remote/signal/start").set(remoteSessionHeader()).send(startPayload()).expect(200);

    connector.connectCalls[0].onSignalEvent("soac", [
      { client_id: "controlled-1", data: { type: "answer", sdp: "v=0" } },
    ]);

    const events = await request(app).get("/api/remote/signal/events").set(remoteSessionHeader()).expect(200);
    expect(events.body).toMatchObject([
      {
        id: 1,
        direction: "inbound",
        event: "soac",
        payload: [{ client_id: "controlled-1", data: { type: "answer", sdp: "v=0" } }],
      },
    ]);

    const control = await request(app)
      .post("/api/remote/signal/control")
      .set(remoteSessionHeader())
      .send({
        appControlId: "control-1",
        appDataBase64: Buffer.from("app-data").toString("base64"),
        streamerData: '{"control_id":"control-1","device_capability":{}}',
      })
      .expect(200);

    expect(connector.connection.emitWithAckCalls[0].event).toBe("control");
    expect(Buffer.from(connector.connection.emitWithAckCalls[0].payload.app_data).toString()).toBe("app-data");
    expect(connector.connection.emitWithAckCalls[0].payload.streamer_data).toBe(
      '{"control_id":"control-1","device_capability":{}}',
    );
    expect(control.body).toMatchObject({
      event: "control",
      ackStatus: "success",
      ack: [
        "success",
        {
          code: 0,
          msg: "ok",
          app_data: {
            kind: "binary",
            byteLength: 3,
            base64: "AQID",
          },
          iceServers: [
            {
              urls: "stun:stun.example:3478",
            },
          ],
        },
      ],
      control: {
        ackStatus: "success",
        result: {
          code: 0,
          msg: "ok",
          appDataBase64: "AQID",
          iceServers: [
            {
              urls: "stun:stun.example:3478",
            },
          ],
        },
      },
    });
    expect(JSON.stringify(control.body)).not.toContain("room-secret-token");

    const soac = await request(app)
      .post("/api/remote/signal/soac")
      .set(remoteSessionHeader())
      .send({
        type: "candidate",
        iceId: "ice-1",
        candidate: {
          candidate: "candidate:1 1 udp 1 192.168.1.2 10000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      })
      .expect(200);

    expect(connector.connection.emitCalls).toEqual([]);
    expect(connector.connection.emitWithOptionalAckCalls).toMatchObject([
      {
        event: "soac",
        payload: {
          data: {
            type: "candidate",
            ice_id: "ice-1",
            candidate: {
              candidate: "candidate:1 1 udp 1 192.168.1.2 10000 typ host",
              sdpMid: "0",
              sdpMLineIndex: 0,
            },
          },
        },
      },
    ]);
    expect(soac.body).toMatchObject({ event: "soac" });
  });

  it("validates SOAC ice_network_type as the integer enum", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app } = createApp({ signalGatewayConnector: connector });
    await request(app).post("/api/remote/signal/start").set(remoteSessionHeader()).send(startPayload()).expect(200);

    await request(app)
      .post("/api/remote/signal/soac")
      .set(remoteSessionHeader())
      .send({
        type: "offer",
        sdp: "v=0",
        iceNetworkType: "v4-wlan",
      })
      .expect(400);

    await request(app)
      .post("/api/remote/signal/soac")
      .set(remoteSessionHeader())
      .send({
        type: "offer",
        sdp: "v=0",
        iceNetworkType: STREAMER_ICE_NETWORK_TYPES.v4Wlan,
      })
      .expect(200);

    expect(connector.connection.emitWithOptionalAckCalls.at(-1)?.payload).toMatchObject({
      data: {
        type: "offer",
        ice_network_type: STREAMER_ICE_NETWORK_TYPES.v4Wlan,
      },
    });
  });

  it("returns token-safe readiness diagnostics for the current signal event log", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app } = createApp({ signalGatewayConnector: connector });
    await request(app).post("/api/remote/signal/start").set(remoteSessionHeader()).send(startPayload()).expect(200);

    await request(app)
      .post("/api/remote/signal/control")
      .set(remoteSessionHeader())
      .send({
        appControlId: "control-1",
        appDataBase64: Buffer.from("app-data").toString("base64"),
        streamerData: '{"control_id":"control-1","device_capability":{}}',
      })
      .expect(200);
    await request(app)
      .post("/api/remote/signal/soac")
      .set(remoteSessionHeader())
      .send({
        type: "offer",
        clientId: "controlled-1",
        appControlId: "control-1",
        iceId: "ice-1",
        sdp: "v=0",
        gzipSdp: false,
      })
      .expect(200);
    connector.connectCalls[0].onSignalEvent("leave", [{ ice_id: "ice-1", "ntes-trace-id": "trace-server-kick-1" }]);

    const diagnostics = await request(app).get("/api/remote/signal/diagnostics").set(remoteSessionHeader()).expect(200);

    expect(diagnostics.body).toMatchObject({
      stage: "offer_sent",
      blocker: "controlled_left_before_answer",
      selectedSignalServer: "wss://signal.example",
      checks: {
        signalGatewayConnected: true,
        controlAckReceived: true,
        offerSent: true,
        answerReceived: false,
      },
      counts: {
        outboundControl: 1,
        inboundControlAck: 1,
        outboundOffer: 1,
        inboundLeave: 1,
      },
      terminalSignal: {
        event: "leave",
        reason: "server_kick",
        traceId: "trace-server-kick-1",
        iceIdPresent: true,
        iceIdMatchesLastOffer: true,
      },
    });
    expect(JSON.stringify(diagnostics.body)).not.toContain("room-secret-token");
  });

  it("isolates signal state and control by browser session capability", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app } = createApp({ signalGatewayConnector: connector });

    await request(app)
      .post("/api/remote/signal/start")
      .set(REMOTE_SESSION_HEADER, REMOTE_SESSION_ID)
      .send(startPayload())
      .expect(200);

    const otherStatus = await request(app)
      .get("/api/remote/signal/status")
      .set(REMOTE_SESSION_HEADER, OTHER_REMOTE_SESSION_ID)
      .expect(200);
    expect(otherStatus.body.status).toBe("idle");

    await request(app)
      .post("/api/remote/signal/control")
      .set(REMOTE_SESSION_HEADER, OTHER_REMOTE_SESSION_ID)
      .send({ appControlId: "control-1" })
      .expect(409);
  });

  it("returns only signal events newer than the requested cursor", async () => {
    const connector = new FakeSignalGatewayConnector();
    const { app } = createApp({ signalGatewayConnector: connector });
    await request(app).post("/api/remote/signal/start").set(remoteSessionHeader()).send(startPayload()).expect(200);
    connector.connectCalls[0].onSignalEvent("soac", [{ data: { type: "answer" } }]);
    connector.connectCalls[0].onSignalEvent("leave", [{}]);

    const events = await request(app).get("/api/remote/signal/events?after=1").set(remoteSessionHeader()).expect(200);
    expect(events.body).toHaveLength(1);
    expect(events.body[0].id).toBe(2);

    await request(app).get("/api/remote/signal/events?after=invalid").set(remoteSessionHeader()).expect(400);
  });
});

const REMOTE_SESSION_ID = "0123456789abcdef0123456789abcdef";
const OTHER_REMOTE_SESSION_ID = "fedcba9876543210fedcba9876543210";

function createApp(overrides: AppOverrides = {}) {
  const result = createUnregisteredApp(overrides);
  result.services.remoteControlSessions.authorize(REMOTE_SESSION_ID, {
    token: startPayload().roomConfig.token,
    servers: startPayload().roomConfig.signalServers,
    expiresAt: Date.now() + 60_000,
  });
  return result;
}

function remoteSessionHeader() {
  return { [REMOTE_SESSION_HEADER]: REMOTE_SESSION_ID };
}

function startPayload() {
  return {
    roomConfig: {
      token: "room-secret-token",
      signalServers: ["wss://signal.example"],
      timeout: 12000,
      signalReconnectDelay: 1500,
      appData: "{}",
    },
    joinContext: {
      capturedAt: "2026-05-15T00:00:00.000Z",
      deviceId: "desktop-1",
      forceJoin: true,
    },
  };
}

class FakeSignalGatewayConnector implements SignalGatewayConnector {
  readonly connectCalls: SignalGatewayConnectOptions[] = [];
  readonly connection = new FakeSignalGatewayConnection();

  async connect(options: SignalGatewayConnectOptions): Promise<FakeSignalGatewayConnection> {
    this.connectCalls.push(options);
    return this.connection;
  }
}

class FakeSignalGatewayConnection {
  readonly id = "route-signal-1";
  closed = false;
  readonly emitCalls: Array<{
    event: string;
    payload: Record<string, unknown>;
  }> = [];
  readonly emitWithAckCalls: Array<{
    event: string;
    payload: Record<string, unknown>;
    ackTimeoutMs: number;
  }> = [];
  readonly emitWithOptionalAckCalls: Array<{
    event: string;
    payload: Record<string, unknown>;
    onAck: (ack: unknown[]) => void;
  }> = [];

  close(): void {
    this.closed = true;
  }

  async emit(event: string, payload: Record<string, unknown>): Promise<void> {
    this.emitCalls.push({ event, payload });
  }

  async emitWithOptionalAck(
    event: string,
    payload: Record<string, unknown>,
    onAck: (ack: unknown[]) => void,
  ): Promise<void> {
    this.emitWithOptionalAckCalls.push({ event, payload, onAck });
  }

  async emitWithAck(event: string, payload: Record<string, unknown>, ackTimeoutMs: number): Promise<unknown[]> {
    this.emitWithAckCalls.push({ event, payload, ackTimeoutMs });
    return [
      "success",
      {
        code: 0,
        msg: "ok",
        app_data: Buffer.from([1, 2, 3]),
        iceServers: [
          {
            urls: "stun:stun.example:3478",
          },
        ],
      },
    ];
  }
}
