import { APP_PACKAGE, VERSION_NAME } from "./constants.js";

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (text.startsWith("key_")) return text;
  if (text === APP_PACKAGE || text === VERSION_NAME) return text;
  if (/^Bearer\s+/i.test(text)) return "<redacted bearer>";
  if (/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(text)) {
    return `<redacted jwt len=${text.length}>`;
  }
  if (text.length >= 12 && /^[A-Za-z0-9._+/=:-]+$/.test(text)) {
    return `<redacted len=${text.length}>`;
  }
  return text.replace(/\d{6,}/g, "<num>");
}

const SIGNAL_PAYLOAD_SENSITIVE_KEYS = new Set([
  "credential",
  "username",
  "token",
  "password",
  "secret",
  "authorization",
]);
const SIGNAL_PAYLOAD_MAX_DEPTH = 8;

// 按敏感键脱敏信令事件 payload(如 control ack 里 TURN iceServers 的 username/credential),
// 保留其余字段的原文以便调试;通用 redact() 会把 SDP/base64 全部模糊化,不适用于事件原文展示
export function redactSignalEventPayload(value: unknown, depth = 0): unknown {
  if (depth >= SIGNAL_PAYLOAD_MAX_DEPTH) return "<truncated depth>";
  if (Array.isArray(value)) return value.map((item) => redactSignalEventPayload(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SIGNAL_PAYLOAD_SENSITIVE_KEYS.has(key.toLowerCase())
        ? `<redacted len=${String(item ?? "").length}>`
        : redactSignalEventPayload(item, depth + 1);
    }
    return result;
  }
  return value;
}
