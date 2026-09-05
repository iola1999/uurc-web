import ipaddr from "ipaddr.js";
import { normalizeStreamerRoomConfig, type StreamerRoomConfig } from "../roomConfig.js";

export const REMOTE_SESSION_IDLE_MS = 2 * 60_000;
export const ROOM_AUTHORIZATION_MAX_AGE_MS = 24 * 60 * 60_000;

export interface SignalRoomAuthorization {
  token: string;
  servers: string[];
  expiresAt: number;
}

export function isPublicSignalAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function validateSignalServer(server: string): URL {
  const url = new URL(server);
  if (!["wss:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Signal servers require HTTPS or WSS without URL credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    ipaddr.isValid(hostname)
      ? !isPublicSignalAddress(hostname)
      : !hostname.includes(".") || hostname.endsWith(".localhost")
  ) {
    throw new Error("Signal servers must use a public network address");
  }
  return url;
}

export function authorizeUuRoom(path: string, status: number, body: unknown): SignalRoomAuthorization | null {
  if (!/^\/api\/v[12]\/room\/join\//.test(path) || status < 200 || status >= 300) return null;
  if (!body || typeof body !== "object" || ("code" in body && body.code !== 0)) return null;
  const room = normalizeStreamerRoomConfig(body);
  if (!room?.token || !room.signalServers.length) return null;
  room.signalServers.forEach(validateSignalServer);
  return { token: room.token, servers: room.signalServers, expiresAt: Date.now() + ROOM_AUTHORIZATION_MAX_AGE_MS };
}

export function isAuthorizedSignalRoom(
  authorization: SignalRoomAuthorization | null | undefined,
  room: StreamerRoomConfig | undefined,
): boolean {
  return Boolean(
    authorization &&
    room &&
    authorization.expiresAt > Date.now() &&
    room.token === authorization.token &&
    room.signalServers.length > 0 &&
    room.signalServers.every((server) => authorization.servers.includes(server)),
  );
}
