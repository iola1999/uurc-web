import { APP_PACKAGE, APP_SIGNING_KEY, VERSION_CODE, VERSION_NAME } from "@uurc/shared/constants";
import type { LoginState } from "@uurc/shared/authState";

interface HeaderOverrides {
  channel?: string;
  operator?: string;
  abi?: string;
  clientId?: string;
  timestamp?: number;
  country?: string;
  language?: string;
}

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

export async function buildSignedHeaders({
  state,
  method,
  pathWithQuery,
  body = "",
  overrides = {},
}: {
  state: Partial<LoginState>;
  method: string;
  pathWithQuery: string;
  body?: string;
  overrides?: HeaderOverrides;
}): Promise<Record<string, string>> {
  const headers = buildCommonHeaders(state, overrides);
  headers["X-Param-SIGN"] = await hmacSha256Hex(buildSignatureBase({ method, pathWithQuery, headers, body }));

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  return headers;
}

function buildCommonHeaders(state: Partial<LoginState>, overrides: HeaderOverrides = {}): Record<string, string> {
  return {
    "X-Param-CHN": overrides.channel ?? state.channel ?? "nochannel",
    "X-Param-OPR": overrides.operator ?? "",
    "X-Param-PKGN": APP_PACKAGE,
    "X-Param-PLAT": "2",
    "X-Param-REL": "prod",
    "X-Param-VC": VERSION_CODE,
    "X-Param-VN": VERSION_NAME,
    "X-Param-ABI": overrides.abi ?? "arm64-v8a",
    "X-Param-client-id": overrides.clientId ?? state.clientId ?? "",
    "X-Param-device-id": state.deviceId ?? "",
    "X-Param-user-id": state.userId ?? "",
    "X-Param-OAID": state.oaid ?? "",
    "X-Param-TS": String(overrides.timestamp ?? Math.floor(Date.now() / 1000)),
    "X-Param-CNT": overrides.country ?? "CN",
    "X-Param-LANG": overrides.language ?? "zh-CN",
  };
}

function buildSignatureBase({
  method,
  pathWithQuery,
  headers,
  body = "",
}: {
  method: string;
  pathWithQuery: string;
  headers: Record<string, string | number | undefined | null>;
  body?: string;
}): string {
  const xParam = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .filter(([name]) => name.startsWith("x-param-"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value ?? ""}`)
    .join("&");

  return `${method.toUpperCase()}${pathWithQuery}${xParam}${body}`;
}

async function hmacSha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("当前页面无法使用安全加密，请通过 HTTPS 或 localhost 访问后重试");
  }

  const encoder = new TextEncoder();
  const key = await subtle.importKey("raw", encoder.encode(APP_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await subtle.sign("HMAC", key, encoder.encode(input));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
