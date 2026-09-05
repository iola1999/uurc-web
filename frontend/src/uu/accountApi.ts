import { decodeJwtPayload, type AuthStatus, type LoginState } from "@uurc/shared/authState";
import {
  buildAndroidDeviceInitRequest,
  buildMobileCodeRequest,
  buildMobileLoginRequest,
  normalizeDeviceInitResult,
  normalizeMobileLoginResult,
  type AndroidDeviceInitProfile,
  type MobileLoginResult,
} from "@uurc/shared/loginFlow";
import type { UuResponse } from "@uurc/shared/uuTransport";

import {
  clearStoredLoginState,
  exportStoredLoginState,
  getStoredAuthStatus,
  getStoredLoginState,
  importStoredLoginState,
  patchStoredLoginState,
} from "./loginStateStore.js";
import { createSyntheticAndroidProfile } from "./profile.js";
import { clearRoomSession } from "./roomSessionStore.js";
import { signedUuRequest, assertUuSuccess as assertUpstreamOk } from "./uuTransportClient.js";

export function getAuthStatus(): AuthStatus {
  return getStoredAuthStatus();
}

export function clearAuthState(): AuthStatus {
  clearRoomSession();
  return clearStoredLoginState();
}

export function importAuthState(rawJson: string): AuthStatus {
  return importStoredLoginState(JSON.parse(rawJson));
}

export function exportAuthState(): LoginState {
  return exportStoredLoginState();
}

export async function createMobileDevice(
  profileOverrides: Partial<AndroidDeviceInitProfile> = {},
): Promise<{ status: AuthStatus; deviceId: string; upstream: UuResponse }> {
  const currentState = getStoredLoginState() ?? {};
  if (currentState.deviceId) {
    return {
      status: getStoredAuthStatus(),
      deviceId: currentState.deviceId,
      upstream: {
        status: 200,
        statusText: "Already Initialized",
        headers: {},
        body: { code: 0, data: { device_id: currentState.deviceId }, local: true },
      },
    };
  }

  const { state, profile } = createSyntheticAndroidProfile(currentState, profileOverrides);
  const request = buildAndroidDeviceInitRequest(profile);
  const upstream = await signedUuRequest({ ...request, state, requireAuth: false });
  assertUpstreamOk(upstream.body);
  const deviceId = normalizeDeviceInitResult(upstream.body);
  const status = patchStoredLoginState({ ...state, deviceId });
  return { status, deviceId, upstream };
}

export async function sendMobileCode(input: {
  regionCode: string;
  mobile: string;
}): Promise<{ status: AuthStatus; deviceId: string; upstream: UuResponse }> {
  const device = await createMobileDevice();
  const request = buildMobileCodeRequest(normalizeMobileInput(input));
  const upstream = await signedUuRequest({ ...request, state: getStoredLoginState() ?? {}, requireAuth: false });
  assertUpstreamOk(upstream.body);
  return { status: getStoredAuthStatus(), deviceId: device.deviceId, upstream };
}

export async function loginByMobile(input: {
  regionCode: string;
  mobile: string;
  code: string;
}): Promise<{ status: AuthStatus; login: Omit<MobileLoginResult, "token">; upstream: UuResponse }> {
  await createMobileDevice();
  const request = buildMobileLoginRequest(normalizeMobileLoginInput(input));
  const upstream = await signedUuRequest({ ...request, state: getStoredLoginState() ?? {}, requireAuth: false });
  assertUpstreamOk(upstream.body);

  const login = normalizeMobileLoginResult(upstream.body);
  const payload = decodeJwtPayload(login.token);
  const tokenClientId = typeof payload.client_id === "string" ? payload.client_id : "";
  const status = patchStoredLoginState({
    token: login.token,
    userId: login.userId,
    clientId: getStoredLoginState()?.clientId || tokenClientId,
  });
  return { status, login: { userId: login.userId, nickName: login.nickName }, upstream };
}

function normalizeMobileInput(input: { regionCode: string; mobile: string }) {
  const regionCode = input.regionCode.trim() || "86";
  const mobile = input.mobile.trim();
  if (!mobile) throw new Error("mobile is required");
  return { regionCode, mobile };
}

function normalizeMobileLoginInput(input: { regionCode: string; mobile: string; code: string }) {
  const normalized = normalizeMobileInput(input);
  const code = input.code.trim();
  if (!code) throw new Error("code is required");
  return { ...normalized, code };
}
