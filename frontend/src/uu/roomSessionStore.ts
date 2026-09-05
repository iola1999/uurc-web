import {
  normalizeStreamerRoomConfig,
  summarizeStreamerRoomConfig,
  type StreamerRoomConfig,
} from "@uurc/shared/roomConfig";
import type {
  RemoteAssistanceControlMode,
  RemoteRoomJoinContext,
  RoomJoinResult,
  RoomJoinUpstreamSummary,
} from "@uurc/shared/roomSession";
import type { UuResponse } from "@uurc/shared/uuTransport";
import { getRemoteSessionId } from "../api/remoteSession.js";
import { getStoredLoginState } from "./loginStateStore.js";

const ROOM_SESSION_KEY = "uurc.latestRoomSession";

interface BrowserRoomSession {
  sessionId: string;
  userId: string | undefined;
  capturedAt: string;
  joinContext: RemoteRoomJoinContext;
  roomConfig: StreamerRoomConfig;
  upstream: RoomJoinUpstreamSummary;
}

export function saveRoomJoinResult(input: {
  deviceId: string;
  forceJoin: boolean;
  upstream: UuResponse;
}): RoomJoinResult {
  return saveRoomSessionResult({
    upstream: input.upstream,
    joinContext: {
      capturedAt: new Date().toISOString(),
      kind: "owned_device",
      deviceId: input.deviceId,
      forceJoin: input.forceJoin,
    },
  });
}

export function saveRemoteAssistanceRoomJoinResult(input: {
  connectId: string;
  connectCodeProvided: boolean;
  controlId?: string;
  controlMode?: RemoteAssistanceControlMode | null;
  deviceName?: string;
  targetPlatform?: number;
  upstream: UuResponse;
}): RoomJoinResult {
  return saveRoomSessionResult({
    upstream: input.upstream,
    joinContext: {
      capturedAt: new Date().toISOString(),
      kind: "remote_assistance",
      deviceId: input.connectId,
      forceJoin: false,
      connectId: input.connectId,
      connectCodeProvided: input.connectCodeProvided,
      controlId: input.controlId,
      controlMode: input.controlMode,
      deviceName: input.deviceName,
      targetPlatform: input.targetPlatform,
    },
  });
}

function saveRoomSessionResult(input: { upstream: UuResponse; joinContext: RemoteRoomJoinContext }): RoomJoinResult {
  const roomConfig = normalizeStreamerRoomConfig(input.upstream.body);
  const upstream = summarizeUpstreamForClient(input.upstream);

  if (roomConfig) {
    const session: BrowserRoomSession = {
      sessionId: getRemoteSessionId(),
      userId: getStoredLoginState()?.userId,
      capturedAt: input.joinContext.capturedAt,
      joinContext: input.joinContext,
      roomConfig,
      upstream,
    };
    window.sessionStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(session));
  } else {
    clearRoomSession();
  }

  return {
    upstream,
    roomConfig: null,
    roomConfigSummary: summarizeStreamerRoomConfig(roomConfig),
    sessionReference: {
      browserStoragePath: `browser:sessionStorage:${ROOM_SESSION_KEY}`,
      summaryPath: `browser:memory:redacted-room-summary`,
    },
  };
}

export function getRoomSession(): BrowserRoomSession | null {
  const raw = window.sessionStorage.getItem(ROOM_SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as BrowserRoomSession;
    if (
      parsed.sessionId !== getRemoteSessionId() ||
      parsed.userId !== getStoredLoginState()?.userId ||
      !Number.isFinite(Date.parse(parsed.capturedAt)) ||
      Date.now() - Date.parse(parsed.capturedAt) > 24 * 60 * 60 * 1000
    ) {
      clearRoomSession();
      return null;
    }
    if (!parsed.roomConfig?.token || !parsed.roomConfig.signalServers?.length) return null;
    return parsed;
  } catch {
    clearRoomSession();
    return null;
  }
}

export function clearRoomSession(): void {
  window.sessionStorage.removeItem(ROOM_SESSION_KEY);
}

export function summarizeUpstreamForClient(upstream: UuResponse): RoomJoinUpstreamSummary {
  const body = asRecord(upstream.body);
  const data = asRecord(body?.data);
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: pickSafeHeaders(upstream.headers),
    body: {
      code: numberValue(body?.code),
      msg: stringValue(body?.msg),
      dataKeys: data ? Object.keys(data) : undefined,
    },
  };
}

function pickSafeHeaders(headers: Record<string, string>): Record<string, string> {
  const safeHeaders: Record<string, string> = {};
  for (const key of ["content-type", "date", "server"]) {
    if (headers[key]) safeHeaders[key] = headers[key];
  }
  return safeHeaders;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
