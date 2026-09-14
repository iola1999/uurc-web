import { describe, expect, it } from "vitest";
import {
  authorizeUuRoom,
  isAuthorizedSignalRoom,
  isResolvableSignalAddress,
  validateSignalServer,
} from "../src/signalGateway/authorization.js";

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

describe("signal DNS resolution guard", () => {
  it.each(["8.8.8.8", "42.186.98.140"])("accepts public address %s", (address) => {
    expect(isResolvableSignalAddress(address)).toBe(true);
  });

  // Surge/Clash 等代理 fake-IP 模式的解析结果,TUN 接管下连接它等价于连接真实服务器
  it("accepts proxy fake-IP resolutions in 198.18.0.0/15", () => {
    expect(isResolvableSignalAddress("198.18.254.63")).toBe(true);
  });

  it.each(["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1"])(
    "rejects internal address %s",
    (address) => {
      expect(isResolvableSignalAddress(address)).toBe(false);
    },
  );

  it("keeps fake-IP literals out of signal server configuration", () => {
    expect(() => validateSignalServer("wss://198.18.254.63")).toThrow();
  });
});
