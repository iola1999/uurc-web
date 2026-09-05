import type {
  RemoteAssistanceControlMode,
  RemoteAssistanceControlModeResult,
  RemoteAssistanceJoinInput,
  RemoteAssistanceJoinResult,
  RoomJoinUpstreamSummary,
} from "@uurc/shared/roomSession";
import type { UuResponse } from "@uurc/shared/uuTransport";

import {
  clearRoomSession,
  saveRemoteAssistanceRoomJoinResult,
  summarizeUpstreamForClient,
} from "./roomSessionStore.js";
import { signedUuRequest, assertUuSuccess } from "./uuTransportClient.js";

const CONFIRMATION_REQUIRED_CODE = 0x470;
const CONTROL_MODES = new Set<RemoteAssistanceControlMode>(["by_password", "by_confirmation", "password_confirmation"]);

export async function getRemoteAssistanceControlMode(connectId: string): Promise<RemoteAssistanceControlModeResult> {
  const normalizedConnectId = normalizeConnectId(connectId);
  const upstream = await signedUuRequest({
    method: "POST",
    path: "/api/v2/room/share/control_mode",
    body: { connect_id: normalizedConnectId },
  });
  const body = asRecord(upstream.body);
  const data = asRecord(body?.data) ?? body;
  return {
    upstream: summarizeUpstreamForClient(upstream),
    connectId: normalizedConnectId,
    canRemoteControl: data?.can_remote_control === true,
    controlMode: controlModeValue(data?.control_mode),
  };
}

export async function joinRemoteAssistanceByCode(
  input: RemoteAssistanceJoinInput,
): Promise<RemoteAssistanceJoinResult> {
  const connectId = normalizeConnectId(input.connectId);
  const connectCode = normalizeConnectCode(input.connectCode);
  const upstream = await signedUuRequest({
    method: "POST",
    path: "/api/v2/room/join/share/by_code",
    body: { connect_id: connectId, connect_code: connectCode },
  });
  return buildJoinResult({
    connectId,
    connectCodeProvided: true,
    controlId: input.controlId,
    controlMode: input.controlMode,
    upstream,
    usedConfirmation: false,
  });
}

export async function joinRemoteAssistanceByConfirmation(
  input: RemoteAssistanceJoinInput,
): Promise<RemoteAssistanceJoinResult> {
  const connectId = normalizeConnectId(input.connectId);
  const controlId = normalizeOptionalString(input.controlId);
  const upstream = await signedUuRequest({
    method: "POST",
    path: "/api/v2/room/join/share/by_confirmation",
    body: { connect_id: connectId, ...(controlId ? { control_id: controlId } : {}) },
  });
  return buildJoinResult({
    connectId,
    connectCodeProvided: Boolean(input.connectCode?.trim()),
    controlId,
    controlMode: input.controlMode,
    upstream,
    usedConfirmation: true,
  });
}

export async function cancelRemoteAssistance(connectId: string): Promise<RoomJoinUpstreamSummary> {
  const upstream = await signedUuRequest({
    method: "POST",
    path: "/api/v2/room/share/cancel_remote_assist",
    body: { connect_id: normalizeConnectId(connectId) },
  });
  assertUuSuccess(upstream.body);
  return summarizeUpstreamForClient(upstream);
}

async function buildJoinResult(input: {
  connectId: string;
  connectCodeProvided: boolean;
  controlId?: string;
  controlMode?: RemoteAssistanceControlMode | null;
  upstream: UuResponse;
  usedConfirmation: boolean;
}): Promise<RemoteAssistanceJoinResult> {
  const deviceName = readNestedString(input.upstream.body, "device_name");
  const targetPlatform = readTargetPlatform(input.upstream.body);
  const controlId = input.controlId ?? readNestedString(input.upstream.body, "control_id");
  const result = saveRemoteAssistanceRoomJoinResult({
    connectId: input.connectId,
    connectCodeProvided: input.connectCodeProvided,
    controlId,
    controlMode: input.controlMode,
    deviceName,
    targetPlatform,
    upstream: input.upstream,
  });
  const responseCode = result.upstream.body.code;
  const joinedSuccessfully = responseCode === 0 || result.roomConfigSummary !== null;
  if (joinedSuccessfully && targetPlatform === undefined) {
    clearRoomSession();
    try {
      const cancelled = await cancelRemoteAssistance(input.connectId);
      const cancellationFailed =
        cancelled.status < 200 ||
        cancelled.status >= 300 ||
        (cancelled.body.code !== undefined && cancelled.body.code !== 0);
      if (cancellationFailed) throw new Error(cancelled.body.msg ?? `取消远程协助返回 HTTP ${cancelled.status}`);
    } catch {
      throw new Error("伙伴设备未返回设备系统，自动取消协助失败，请让伙伴端结束本次协助后重试");
    }
    throw new Error("伙伴设备未返回设备系统，已取消本次远程协助");
  }

  return {
    ...result,
    assistance: {
      connectId: input.connectId,
      connectCodeProvided: input.connectCodeProvided,
      confirmationRequired: responseCode === CONFIRMATION_REQUIRED_CODE,
      usedConfirmation: input.usedConfirmation,
      controlId,
      controlMode: input.controlMode,
      deviceName,
      targetPlatform,
    },
  };
}

function normalizeConnectId(connectId: string): string {
  const normalized = connectId.trim();
  if (!normalized) throw new Error("请输入伙伴的设备 ID");
  if (!/^\d{6,12}$/.test(normalized)) throw new Error("伙伴设备 ID 应为 6-12 位数字");
  return normalized;
}

function normalizeConnectCode(connectCode: string | undefined): string {
  const normalized = connectCode?.trim() ?? "";
  if (!normalized) throw new Error("请输入伙伴的设备验证码");
  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function controlModeValue(value: unknown): RemoteAssistanceControlMode | null {
  return typeof value === "string" && CONTROL_MODES.has(value as RemoteAssistanceControlMode)
    ? (value as RemoteAssistanceControlMode)
    : null;
}

function readNestedString(value: unknown, key: string): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const direct = record[key];
  if (typeof direct === "string" && direct.trim()) return direct;
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = readNestedString(item, key);
        if (found) return found;
      }
    } else {
      const found = readNestedString(child, key);
      if (found) return found;
    }
  }
  return undefined;
}

function readTargetPlatform(value: unknown): number | undefined {
  const body = asRecord(value);
  if (!body) return undefined;
  const data = asRecord(body.data);
  const containers = [data, ...roomConfigContainers(data), body, ...roomConfigContainers(body)].filter(
    (item): item is Record<string, unknown> => item !== null,
  );
  for (const key of ["publisher_platform", "device_platform", "platform"]) {
    for (const container of containers) {
      const platform = positiveInteger(container[key]);
      if (platform !== undefined) return platform;
    }
  }
  return undefined;
}

function roomConfigContainers(record: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!record) return [];
  return ["room_config", "roomConfig", "room_info", "roomInfo", "streamer_room_config", "streamerRoomConfig"]
    .map((key) => asRecord(record[key]))
    .filter((item): item is Record<string, unknown> => item !== null);
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
