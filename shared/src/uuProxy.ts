const BLOCKED_PROXY_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding"]);
const ALLOWED_V2_ROOM_PATHS = new Set([
  "/api/v2/room/join/share/by_code",
  "/api/v2/room/join/share/by_confirmation",
  "/api/v2/room/share/control_mode",
  "/api/v2/room/share/cancel_remote_assist",
]);

export function assertAllowedUuApiPath(path: string): void {
  const pathOnly = path.split("?")[0] ?? path;
  if (!path.startsWith("/api/v1/") && !ALLOWED_V2_ROOM_PATHS.has(pathOnly)) {
    throw new Error(`Unsupported UU API path: ${path}`);
  }
  if (/^https?:\/\//i.test(path) || path.includes("..")) {
    throw new Error(`Unsafe UU API path: ${path}`);
  }
}

export function sanitizeUuProxyHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && isForwardableUuProxyHeader(key)) {
      headers[key] = raw;
    }
  }
  return headers;
}

function isForwardableUuProxyHeader(name: string): boolean {
  return !BLOCKED_PROXY_HEADERS.has(name.toLowerCase());
}

export function parseMaybeJsonBody(text: string, contentType: string): unknown {
  if (!text) return null;
  if (!contentType.includes("application/json")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function readBoundedText(
  source: { body: ReadableStream<Uint8Array> | null },
  signal?: AbortSignal,
  maxBytes = 4 * 1024 * 1024,
): Promise<string> {
  signal?.throwIfAborted();
  if (!source.body) return "";
  const reader = source.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error(`Response exceeds ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
