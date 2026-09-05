import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { FakeSignalGatewayConnector } from "./fixtures/signalGateway.js";

afterEach(() => vi.unstubAllGlobals());

it("authorizes the exact room returned by the fixed UU proxy for the requesting session", async () => {
  const upstream = vi.fn(async () =>
    Response.json({ code: 0, data: { room_config: { token: "synthetic", signal_servers: ["wss://signal.example"] } } }),
  );
  vi.stubGlobal("fetch", upstream);
  const connector = new FakeSignalGatewayConnector();
  const { app, services } = createApp({ signalGatewayConnector: connector });
  const id = "synthetic-proxy-session-0000000001";
  await request(app)
    .post("/api/proxy/uu")
    .set("X-UURC-Session", id)
    .send({ method: "POST", path: "/api/v1/room/join/by_device/synthetic" })
    .expect(200);
  expect(upstream).toHaveBeenCalledWith(
    "https://api.nrd.nie.163.com/api/v1/room/join/by_device/synthetic",
    expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
  );
  await request(app)
    .post("/api/remote/signal/start")
    .set("X-UURC-Session", id)
    .send({ roomConfig: { token: "synthetic", signalServers: ["wss://other.example"] } })
    .expect(403);
  await request(app)
    .post("/api/remote/signal/start")
    .set("X-UURC-Session", id)
    .send({ roomConfig: { token: "synthetic", signalServers: ["wss://signal.example"] } })
    .expect(200);
  expect(connector.connectCalls).toHaveLength(1);
  await request(app).delete("/api/remote/signal").set("X-UURC-Session", id).expect(200);
  expect(services.remoteControlSessions.size).toBe(0);
});
