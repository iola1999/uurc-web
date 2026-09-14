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

// Surge、Clash/mihomo 等代理的 fake-IP 模式把任意域名解析到 198.18.0.0/15 保留段,
// TUN 接管下连接该解析结果等价于连接真实服务器,因此解析防护对它例外;
// 配置级校验 validateSignalServer 仍然拒绝该段地址直接出现在信令服务器配置里。
const PROXY_FAKE_IP_V4_CIDR = "198.18.0.0/15";

export function isResolvableSignalAddress(address: string): boolean {
  if (isPublicSignalAddress(address)) return true;
  try {
    const parsed = ipaddr.process(address);
    return parsed.kind() === "ipv4" && (parsed as ipaddr.IPv4).match(ipaddr.parseCIDR(PROXY_FAKE_IP_V4_CIDR));
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
