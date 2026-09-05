import { describe, expect, it } from "vitest";
import { authorizeUuRoom, isAuthorizedSignalRoom, validateSignalServer } from "../src/signalGateway/authorization.js";

describe("signal target authorization", () => {
  it.each([
    "http://signal.example",
    "wss://127.0.0.1",
    "wss://[::1]",
    "wss://[::ffff:127.0.0.1]",
    "wss://169.254.169.254",
    "wss://10.0.0.1",
    "wss://localhost",
    "wss://user:password@signal.example",
  ])("rejects %s", (server) => {
    expect(() => validateSignalServer(server)).toThrow();
  });

  it("only authorizes successful room joins and binds tokens and destinations", () => {
    const body = { code: 0, data: { room_config: { token: "synthetic", signal_servers: ["wss://signal.example"] } } };
    const path = "/api/v1/room/join/by_device/synthetic";
    const authorization = authorizeUuRoom(path, 200, body);
    expect(authorization).not.toBeNull();
    const room = { token: "synthetic", signalServers: ["wss://signal.example"] };
    expect(isAuthorizedSignalRoom(authorization, room)).toBe(true);
    expect(isAuthorizedSignalRoom(authorization, { ...room, signalServers: ["wss://other.example"] })).toBe(false);
    expect(isAuthorizedSignalRoom(authorization, { ...room, token: "other" })).toBe(false);
    expect(isAuthorizedSignalRoom({ ...authorization!, expiresAt: 0 }, room)).toBe(false);
    expect(authorizeUuRoom(path, 401, body)).toBeNull();
    expect(authorizeUuRoom("/api/v1/other", 200, body)).toBeNull();
    expect(authorizeUuRoom(path, 200, { ...body, code: 1 })).toBeNull();
  });
});
