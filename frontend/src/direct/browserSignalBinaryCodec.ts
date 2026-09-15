import type { AsyncSignalGatewayBinaryCodec } from "@uurc/shared/signalGateway/payload";
import { SIGNAL_MAX_SDP_BYTES } from "@uurc/shared/signalGateway/status";
import { readBoundedText } from "@uurc/shared/uuProxy";

// 浏览器侧二进制 codec,与 Cloudflare 的 workerSignalBinaryCodec 同接口同实现
// (Blob/CompressionStream/atob 在两个平台行为一致);Node 侧另有 Buffer 实现。
export const browserSignalGatewayBinary: AsyncSignalGatewayBinaryCodec<Uint8Array> = {
  decodeBase64: decodeBase64Bytes,
  toBinary: toSignalBytes,
  byteLength: (value) => value.byteLength,
  encodeBase64: bytesToBase64,
  gzipText: async (value) => {
    const stream = new Blob([new TextEncoder().encode(value)]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
  gunzipText,
};

function decodeBase64Bytes(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function toSignalBytes(value: unknown): Uint8Array | null {
  const bytes = valueToBytes(value);
  if (bytes) return bytes;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "binary" && typeof record.base64 === "string") return decodeBase64Bytes(record.base64);
  return null;
}

function valueToBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function gunzipText(value: unknown): Promise<string | null> {
  const bytes = toSignalBytes(value);
  if (!bytes) return null;
  try {
    // 拷贝一份以确保底层是普通 ArrayBuffer,满足 DOM BlobPart 类型(排除 SharedArrayBuffer)
    const body = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await readBoundedText({ body }, AbortSignal.timeout(10_000), SIGNAL_MAX_SDP_BYTES);
  } catch {
    return null;
  }
}
