import { summarizeAuthState } from "@uurc/shared/authState";
import type { AuthStatus, LoginState } from "@uurc/shared/authState";

const LOGIN_STATE_KEY = "uurc.loginState";

export function getStoredLoginState(): Partial<LoginState> | null {
  const raw = window.localStorage.getItem(LOGIN_STATE_KEY);
  if (!raw) return null;

  try {
    return normalizeLoginState(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(LOGIN_STATE_KEY);
    return null;
  }
}

export function getStoredAuthStatus(): AuthStatus {
  return summarizeAuthState(getStoredLoginState());
}

export function clearStoredLoginState(): AuthStatus {
  window.localStorage.removeItem(LOGIN_STATE_KEY);
  return summarizeAuthState(null);
}

export function importStoredLoginState(input: unknown): AuthStatus {
  const state = normalizeLoginState(input);
  const status = summarizeAuthState(state);
  if (!status.hasState) throw new Error(`账号凭证缺少 ${status.missingFields.join("、")}`);
  window.localStorage.setItem(LOGIN_STATE_KEY, JSON.stringify(state));
  return status;
}

export function patchStoredLoginState(input: Partial<LoginState>): AuthStatus {
  const next = normalizeLoginState({
    ...(getStoredLoginState() ?? {}),
    ...input,
  });
  window.localStorage.setItem(LOGIN_STATE_KEY, JSON.stringify(next));
  return summarizeAuthState(next);
}

export function exportStoredLoginState(): LoginState {
  const state = getStoredLoginState();
  if (!state) throw new Error("No login state available");
  return state as LoginState;
}

function normalizeLoginState(input: unknown): Partial<LoginState> {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return {
    token: stringValue(record.token),
    userId: stringValue(record.userId ?? record.user_id),
    clientId: stringValue(record.clientId ?? record.client_id),
    deviceId: stringValue(record.deviceId ?? record.device_id),
    oaid: stringValue(record.oaid),
    uuid: stringValue(record.uuid),
    channel: stringValue(record.channel),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
