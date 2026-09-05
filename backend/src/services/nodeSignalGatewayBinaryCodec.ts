import { gzipSync, gunzipSync } from "node:zlib";
import { SIGNAL_MAX_SDP_BYTES } from "@uurc/shared/signalGateway/status";

import type { SignalGatewayBinaryCodec } from "@uurc/shared/signalGateway/payload";

export const nodeSignalGatewayBinary: SignalGatewayBinaryCodec<Buffer> = {
  decodeBase64: (value) => Buffer.from(value ?? "", "base64"),
  toBinary: toSignalBuffer,
  byteLength: (value) => value.byteLength,
  encodeBase64: (value) => value.toString("base64"),
  gzipText: (value) => gzipSync(Buffer.from(value, "utf8"), { level: 6 }),
  gunzipText: (value) => {
    const buffer = toSignalBuffer(value);
    if (!buffer) return null;
    try {
      return gunzipSync(buffer, { maxOutputLength: SIGNAL_MAX_SDP_BYTES }).toString("utf8");
    } catch {
      return null;
    }
  },
};

function toSignalBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (record.kind === "binary" && typeof record.base64 === "string") {
    return Buffer.from(record.base64, "base64");
  }
  return null;
}
