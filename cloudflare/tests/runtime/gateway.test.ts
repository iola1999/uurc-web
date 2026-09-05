import { env, SELF, runInDurableObject, runDurableObjectAlarm, evictDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSignalSession } from "../../src/signalSession.js";
import { SignalSessionStore } from "../../src/signal/signalSessionStore.js";
import { SIGNAL_MAX_EVENT_BYTES } from "@uurc/shared/signalGateway/status";

const headers = { "Content-Type": "application/json", "X-UURC-Session": "synthetic-runtime-session-00000001" };
const room = { token: "synthetic-room", signalServers: ["wss://signal.example"] };
const sessions = (env as { REMOTE_SIGNAL_SESSION: DurableObjectNamespace<RemoteSignalSession> }).REMOTE_SIGNAL_SESSION;

describe("Worker gateway and durable storage", () => {
  it("prunes SQLite history by total bytes as well as event count", async () => {
    await runInDurableObject(sessions.getByName(headers["X-UURC-Session"]), (_instance, state) => {
      const store = new SignalSessionStore(state.storage.sql);
      for (let i = 0; i < 20; i += 1)
        store.recordEvent({ direction: "inbound", event: "synthetic", payload: "x".repeat(128 * 1024) });
      const events = store.readEvents();
      expect(events.length).toBeLessThan(20);
      expect(new TextEncoder().encode(JSON.stringify(events)).byteLength).toBeLessThan(SIGNAL_MAX_EVENT_BYTES);
    });
  });
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Unexpected outbound request");
      }),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await sessions.getByName(headers["X-UURC-Session"]).stop();
  });

  it("expires authorization and events without a later browser request", async () => {
    const stub = sessions.getByName(headers["X-UURC-Session"]);
    const now = Date.now();
    await stub.authorizeRoom({ token: room.token, servers: room.signalServers, expiresAt: now + 86400000 });
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(now);
      state.storage.sql.exec(
        "INSERT INTO signal_events(direction,event,received_at,payload_json) VALUES (?,?,?,?)",
        "inbound",
        "synthetic",
        new Date().toISOString(),
        "[]",
      );
      await state.storage.put("clientExpiresAt", now - 1);
    });
    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get("roomAuthorization")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
      expect(state.storage.sql.exec("SELECT * FROM signal_events").toArray()).toEqual([]);
    });
    expect(await stub.getStatus()).toMatchObject({ status: "closed", signalServers: [] });
  });

  it("reports a lost upstream socket after Durable Object reconstruction", async () => {
    const stub = sessions.getByName(headers["X-UURC-Session"]);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE signal_state SET value = ? WHERE key = 'status'",
        JSON.stringify({ status: "connected", signalServers: [], signalHeaders: {} }),
      );
    });
    await evictDurableObject(stub);
    expect(await stub.getStatus()).toMatchObject({
      status: "closed",
      error: expect.stringContaining("no active upstream"),
    });
  });

  it("rejects an expired client lease before a delayed alarm runs", async () => {
    const stub = sessions.getByName(headers["X-UURC-Session"]);
    await stub.authorizeRoom({
      token: room.token,
      servers: room.signalServers,
      expiresAt: Date.now() + 86400000,
    });
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("clientExpiresAt", Date.now() - 1);
    });
    await evictDurableObject(stub);
    expect(await stub.getStatus()).toMatchObject({ status: "closed" });
    expect(await stub.start({ roomConfig: room })).toMatchObject({ status: "error" });
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get("roomAuthorization")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("prunes expired history when the client only queries status", async () => {
    const stub = sessions.getByName(headers["X-UURC-Session"]);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO signal_events(direction,event,received_at,payload_json) VALUES (?,?,?,?)",
        "inbound",
        "synthetic",
        new Date(Date.now() - 16 * 60_000).toISOString(),
        "[]",
      );
    });
    await stub.getStatus();
    await runInDurableObject(stub, (_instance, state) => {
      expect(state.storage.sql.exec("SELECT * FROM signal_events").toArray()).toEqual([]);
    });
  });

  it("keeps stop authoritative when an earlier connection attempt completes late", async () => {
    const stub = sessions.getByName(headers["X-UURC-Session"]);
    await runInDurableObject(stub, async (instance) => {
      let resolveFetch!: (response: Response) => void;
      const outgoing = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      vi.stubGlobal("fetch", outgoing);
      await instance.authorizeRoom({
        token: room.token,
        servers: room.signalServers,
        expiresAt: Date.now() + 86400000,
      });
      const pending = instance.start({ roomConfig: room });
      await vi.waitFor(() => expect(outgoing).toHaveBeenCalledOnce());
      await instance.stop();
      resolveFetch(new Response(null, { status: 400 }));
      expect(await pending).toMatchObject({ status: "closed" });
      expect(await instance.getEvents()).toEqual([]);
    });
  });

  it("rejects unregistered destinations without an upstream request", async () => {
    const response = await SELF.fetch("https://gateway.example/api/remote/signal/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ roomConfig: room }),
    });
    expect(await response.json()).toMatchObject({ status: "error", error: expect.stringContaining("Join the room") });
  });

  it("registers only the UU join response and isolates the authorization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: 0, data: { room_config: { token: room.token, signal_servers: room.signalServers } } }),
      ),
    );
    const response = await SELF.fetch("https://gateway.example/api/proxy/uu", {
      method: "POST",
      headers,
      body: JSON.stringify({ method: "POST", path: "/api/v1/room/join/by_device/synthetic", body: {} }),
    });
    expect(response.status).toBe(200);
    await runInDurableObject(sessions.getByName(headers["X-UURC-Session"]), async (_instance, state) => {
      expect(await state.storage.get("roomAuthorization")).toMatchObject({
        token: room.token,
        servers: room.signalServers,
      });
    });
    const other = sessions.getByName("synthetic-runtime-session-00000002");
    expect(await other.start({ roomConfig: room })).toMatchObject({ status: "error" });
    expect(
      await sessions
        .getByName(headers["X-UURC-Session"])
        .start({ roomConfig: { ...room, signalServers: ["wss://other.example"] } }),
    ).toMatchObject({ status: "error" });
  });

  it("persists events in SQLite and removes them on stop", async () => {
    const stub = sessions.getByName(headers["X-UURC-Session"]);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO signal_events(direction,event,received_at,payload_json) VALUES (?,?,?,?)",
        "inbound",
        "synthetic",
        new Date().toISOString(),
        "[]",
      );
    });
    expect(await stub.getEvents()).toHaveLength(1);
    await stub.stop();
    expect(await stub.getEvents()).toEqual([]);
  });
});
