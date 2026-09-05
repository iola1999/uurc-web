export interface LoginState {
  token?: string;
  userId?: string;
  clientId?: string;
  deviceId?: string;
  oaid?: string;
  uuid?: string;
  channel?: string;
}

export interface AuthStatus {
  hasState: boolean;
  missingFields: string[];
  userId?: string;
  clientId?: string;
  deviceId?: string;
  channel?: string;
  tokenExpiresAt?: string;
  tokenExpired?: boolean;
}

const REQUIRED_LOGIN_FIELDS: Array<keyof LoginState> = ["token", "userId", "deviceId"];

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  if (!token || token.split(".").length < 2) return {};

  try {
    const payload = token.split(".")[1] ?? "";
    const decoded: unknown = JSON.parse(decodeBase64Url(payload));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function validateLoginState(state: Partial<LoginState> | null | undefined): string[] {
  return REQUIRED_LOGIN_FIELDS.filter((field) => !state?.[field]);
}

export function summarizeAuthState(state: Partial<LoginState> | null | undefined): AuthStatus {
  const missingFields = validateLoginState(state);
  const payload = decodeJwtPayload(state?.token);
  const exp =
    typeof payload.exp === "number" && Number.isFinite(payload.exp) && Math.abs(payload.exp * 1000) <= 8.64e15
      ? payload.exp
      : undefined;
  const tokenExpiresAt = exp !== undefined ? new Date(exp * 1000).toISOString() : undefined;
  const tokenExpired = exp !== undefined ? exp * 1000 <= Date.now() : undefined;

  return {
    hasState: missingFields.length === 0,
    missingFields,
    userId: state?.userId,
    clientId: state?.clientId,
    deviceId: state?.deviceId,
    channel: state?.channel,
    tokenExpiresAt,
    tokenExpired,
  };
}

export function assertLoginState(state: Partial<LoginState> | null | undefined): asserts state is LoginState {
  const missing = validateLoginState(state);
  if (missing.length) {
    throw new Error(`Missing required login state: ${missing.join(", ")}`);
  }
}

function decodeBase64Url(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "base64url").toString("utf8");
  }

  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (!atobFn) return "";

  const binary = atobFn(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
