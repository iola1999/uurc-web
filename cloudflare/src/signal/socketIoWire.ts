import { validateSignalServer } from "@uurc/shared/signalGateway/authorization";

export const SOCKET_IO_NAMESPACE = "/";
export const ENGINE_IO_OPEN = "0";
export const ENGINE_IO_CLOSE = "1";
export const ENGINE_IO_PING = "2";
export const ENGINE_IO_PONG = "3";
export const ENGINE_IO_MESSAGE = "4";

const ENGINE_IO_BINARY_FRAME_PREFIX = 0x04;

export interface SocketIoPacket {
  type: number;
  namespace: string;
  attachments: number;
  id?: number;
  data?: unknown;
}

export function buildEngineIoWebSocketUrl(signalServer: string): string {
  const url = validateSignalServer(signalServer);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (!url.pathname || url.pathname === "/") url.pathname = "/socket.io/";
  else if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  url.searchParams.set("EIO", "4");
  url.searchParams.set("transport", "websocket");
  return url.toString();
}

export function parseEngineOpenPacket(value: string): { sid?: string; pingInterval: number; pingTimeout: number } {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("Invalid Engine.IO open packet");
  const duration = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 300_000)
      throw new Error("Invalid Engine.IO heartbeat duration");
    return value;
  };
  return {
    sid: typeof parsed.sid === "string" ? parsed.sid : undefined,
    pingInterval: duration(parsed.pingInterval, 25_000),
    pingTimeout: duration(parsed.pingTimeout, 20_000),
  };
}

export function parseSocketIoPacket(value: string): SocketIoPacket {
  const type = Number.parseInt(value[0] ?? "", 10);
  if (!Number.isInteger(type)) throw new Error(`invalid socket.io packet type: ${value}`);

  let offset = 1;
  let attachments = 0;
  if (type === 5 || type === 6) {
    const start = offset;
    while (isDigit(value[offset])) offset += 1;
    attachments = Number.parseInt(value.slice(start, offset), 10);
    if (!Number.isInteger(attachments) || attachments < 0 || attachments > 10 || value[offset] !== "-")
      throw new Error("Invalid binary attachment count");
    offset += 1;
  }

  let namespace = SOCKET_IO_NAMESPACE;
  if (value[offset] === "/") {
    const start = offset;
    while (offset < value.length && value[offset] !== ",") offset += 1;
    namespace = value.slice(start, offset);
    if (value[offset] === ",") offset += 1;
  }

  const idStart = offset;
  while (isDigit(value[offset])) offset += 1;
  const idText = value.slice(idStart, offset);
  const id = idText ? Number.parseInt(idText, 10) : undefined;
  const jsonText = value.slice(offset);
  const data = jsonText ? JSON.parse(jsonText) : undefined;
  return { type, namespace, attachments, id, data };
}

export function encodeSocketIoPacket(packet: SocketIoPacket): string {
  let encoded = String(packet.type);
  if (packet.type === 5 || packet.type === 6) encoded += `${packet.attachments}-`;
  if (packet.namespace && packet.namespace !== SOCKET_IO_NAMESPACE) encoded += `${packet.namespace},`;
  if (packet.id !== undefined) encoded += String(packet.id);
  if (packet.data !== undefined) encoded += JSON.stringify(packet.data);
  return encoded;
}

export function deconstructBinary(value: unknown): { data: unknown; buffers: Uint8Array[] } {
  const buffers: Uint8Array[] = [];
  return { data: deconstructBinaryValue(value, buffers), buffers };
}

export function reconstructBinaryPlaceholders(value: unknown, buffers: Uint8Array[]): unknown {
  const record = isRecord(value) ? value : null;
  if (record && record._placeholder === true && typeof record.num === "number") {
    return buffers[record.num] ?? value;
  }
  if (Array.isArray(value)) return value.map((item) => reconstructBinaryPlaceholders(item, buffers));
  if (record) {
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, reconstructBinaryPlaceholders(item, buffers)]),
    );
  }
  return value;
}

export function prefixEngineIoBinaryFrame(value: Uint8Array): Uint8Array {
  const prefixed = new Uint8Array(value.byteLength + 1);
  prefixed[0] = ENGINE_IO_BINARY_FRAME_PREFIX;
  prefixed.set(value, 1);
  return prefixed;
}

export function stripEngineIoBinaryFramePrefix(value: Uint8Array): Uint8Array {
  return value[0] === ENGINE_IO_BINARY_FRAME_PREFIX ? value.slice(1) : value;
}

function deconstructBinaryValue(value: unknown, buffers: Uint8Array[]): unknown {
  const bytes = valueToBytes(value);
  if (bytes) {
    const num = buffers.length;
    buffers.push(bytes);
    return { _placeholder: true, num };
  }
  if (Array.isArray(value)) return value.map((item) => deconstructBinaryValue(item, buffers));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deconstructBinaryValue(item, buffers)]));
  }
  return value;
}

function valueToBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}
