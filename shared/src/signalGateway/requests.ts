import { STREAMER_VERSION_PATTERN } from "../fingerprint.js";
import type { RemoteRoomJoinContext } from "../roomSession.js";
import type { StreamerRoomConfig } from "../roomConfig.js";
import {
  STREAMER_ICE_NETWORK_TYPES,
  STREAMER_SOAC_TYPES,
  type StreamerIceNetworkType,
  type StreamerSoacType,
} from "../streamer/signalSoac.js";
import type {
  RemoteSignalControlRequest,
  RemoteSignalGatewayStartRequest,
  RemoteSignalSoacCandidate,
  RemoteSignalSoacRequest,
} from "./model.js";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function parseOptionalEventId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ValidationError("after must be a non-negative integer");
  }
  return Number.parseInt(value, 10);
}

export function parseSignalGatewayStartRequest(body: unknown): RemoteSignalGatewayStartRequest {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object") {
    throw new ValidationError("Expected a JSON signal gateway payload");
  }

  const record = body as Record<string, unknown>;
  assertOptionalBoolean(record.gzipSdp, "gzipSdp");
  assertOptionalNonNegativeInteger(record.signalServerIndex, "signalServerIndex");
  assertOptionalStreamerVersion(record.streamerVersion, "streamerVersion");

  return {
    gzipSdp: record.gzipSdp,
    signalServerIndex: record.signalServerIndex,
    streamerVersion: record.streamerVersion,
    roomConfig: parseOptionalRoomConfig(record.roomConfig),
    joinContext: parseOptionalJoinContext(record.joinContext),
  };
}

export function parseSignalControlRequest(body: unknown): RemoteSignalControlRequest {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Expected a JSON control payload");
  }

  const record = body as Record<string, unknown>;
  if (typeof record.appControlId !== "string" || record.appControlId.length === 0) {
    throw new ValidationError("appControlId is required");
  }

  const appDataBase64 = record.appDataBase64;
  const streamerData = record.streamerData;
  assertOptionalBase64String(appDataBase64, "appDataBase64");
  assertOptionalString(streamerData, "streamerData");
  return { appControlId: record.appControlId, appDataBase64, streamerData };
}

export function parseSignalSoacRequest(body: unknown): RemoteSignalSoacRequest {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Expected a JSON SOAC payload");
  }

  const record = body as Record<string, unknown>;
  if (!isStreamerSoacType(record.type)) {
    throw new ValidationError(`type must be one of ${STREAMER_SOAC_TYPES.join(", ")}`);
  }

  assertOptionalString(record.clientId, "clientId");
  assertOptionalString(record.appControlId, "appControlId");
  assertOptionalString(record.iceId, "iceId");
  assertOptionalString(record.sdp, "sdp");
  assertOptionalStreamerIceNetworkType(record.iceNetworkType, "iceNetworkType");
  assertOptionalBoolean(record.gzipSdp, "gzipSdp");

  const candidate = parseOptionalSoacCandidate(record.candidate);
  if (record.type === "candidate" && !candidate) {
    throw new ValidationError("candidate is required for SOAC candidate messages");
  }

  return {
    type: record.type,
    clientId: record.clientId,
    appControlId: record.appControlId,
    iceId: record.iceId,
    sdp: record.sdp,
    gzipSdp: record.gzipSdp,
    iceNetworkType: record.iceNetworkType,
    candidate,
  };
}

function parseOptionalRoomConfig(value: unknown): StreamerRoomConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("roomConfig must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || record.token.length === 0) {
    throw new ValidationError("roomConfig.token is required");
  }
  if (
    !Array.isArray(record.signalServers) ||
    !record.signalServers.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new ValidationError("roomConfig.signalServers must be a string array");
  }
  assertOptionalNonNegativeInteger(record.timeout, "roomConfig.timeout");
  assertOptionalNonNegativeInteger(record.signalReconnectDelay, "roomConfig.signalReconnectDelay");
  assertOptionalString(record.reportToken, "roomConfig.reportToken");
  assertOptionalString(record.reportUrl, "roomConfig.reportUrl");
  assertOptionalString(record.reportServerAddress, "roomConfig.reportServerAddress");
  assertOptionalString(record.appData, "roomConfig.appData");

  return {
    token: record.token,
    signalServers: record.signalServers,
    timeout: record.timeout,
    signalReconnectDelay: record.signalReconnectDelay,
    reportToken: record.reportToken,
    reportUrl: record.reportUrl,
    reportServerAddress: record.reportServerAddress,
    appData: record.appData,
  };
}

function parseOptionalJoinContext(value: unknown): RemoteRoomJoinContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("joinContext must be an object");
  }
  const record = value as Record<string, unknown>;
  assertOptionalString(record.capturedAt, "joinContext.capturedAt");
  assertOptionalString(record.deviceId, "joinContext.deviceId");
  assertOptionalBoolean(record.forceJoin, "joinContext.forceJoin");
  if (!record.capturedAt || !record.deviceId || record.forceJoin === undefined) {
    throw new ValidationError("joinContext.capturedAt, deviceId, and forceJoin are required");
  }
  return { capturedAt: record.capturedAt, deviceId: record.deviceId, forceJoin: record.forceJoin };
}

function assertOptionalBase64String(value: unknown, fieldName: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a base64 string`);
  }
}

function isStreamerSoacType(value: unknown): value is StreamerSoacType {
  return typeof value === "string" && (STREAMER_SOAC_TYPES as readonly string[]).includes(value);
}

function assertOptionalString(value: unknown, fieldName: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
}

function assertOptionalBoolean(value: unknown, fieldName: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new ValidationError(`${fieldName} must be a boolean`);
  }
}

// streamerVersion 会进入信令 WebSocket 握手 header,正则校验同时是 CRLF 注入防线,Node 与 Cloudflare 共用,不可放宽
function assertOptionalStreamerVersion(value: unknown, fieldName: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== "string" || !STREAMER_VERSION_PATTERN.test(value))) {
    throw new ValidationError(`${fieldName} must match ${STREAMER_VERSION_PATTERN.source}`);
  }
}

function assertOptionalNonNegativeInteger(value: unknown, fieldName: string): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
    throw new ValidationError(`${fieldName} must be a non-negative integer`);
  }
}

function assertOptionalStreamerIceNetworkType(
  value: unknown,
  fieldName: string,
): asserts value is StreamerIceNetworkType | undefined {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Object.values(STREAMER_ICE_NETWORK_TYPES).includes(value as StreamerIceNetworkType)
  ) {
    throw new ValidationError(`${fieldName} must be a known streamer ICE network type`);
  }
}

function parseOptionalSoacCandidate(value: unknown): RemoteSignalSoacCandidate | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new ValidationError("candidate must be an object");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.candidate !== "string" || record.candidate.length === 0) {
    throw new ValidationError("candidate.candidate is required");
  }
  assertOptionalString(record.sdpMid, "candidate.sdpMid");
  if (record.sdpMLineIndex !== undefined && !Number.isInteger(record.sdpMLineIndex)) {
    throw new ValidationError("candidate.sdpMLineIndex must be an integer");
  }

  return {
    candidate: record.candidate,
    sdpMid: record.sdpMid,
    sdpMLineIndex: record.sdpMLineIndex as number | undefined,
  };
}
