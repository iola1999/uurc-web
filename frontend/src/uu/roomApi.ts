import { DEVICE_GROUPS_PATH } from "@uurc/shared/constants";
import { createRemoteControlBootstrap, type RemoteControlBootstrap } from "@uurc/shared/remoteBootstrap";
import type { RoomJoinResult, RoomJoinUpstreamSummary } from "@uurc/shared/roomSession";

import { flattenDeviceGroups } from "../devices/deviceSummary.js";
import { getRoomSession, saveRoomJoinResult, summarizeUpstreamForClient } from "./roomSessionStore.js";
import { signedUuRequest, assertUuSuccess } from "./uuTransportClient.js";

export async function getDeviceGroups() {
  const response = await signedUuRequest({ method: "GET", path: DEVICE_GROUPS_PATH });
  assertUuSuccess(response.body);
  return flattenDeviceGroups(response);
}

export async function joinRoomByDevice(deviceId: string, forceJoin: boolean): Promise<RoomJoinResult> {
  const upstream = await signedUuRequest({
    method: "POST",
    path: `/api/v1/room/join/by_device/${encodeURIComponent(deviceId)}`,
    body: { force_join: forceJoin },
  });
  return saveRoomJoinResult({ deviceId, forceJoin, upstream });
}

export async function clearRoomByDevice(deviceId: string): Promise<RoomJoinUpstreamSummary> {
  const upstream = await signedUuRequest({
    method: "POST",
    path: `/api/v1/room/clear/by_device/${encodeURIComponent(deviceId)}`,
  });
  assertUuSuccess(upstream.body);
  return summarizeUpstreamForClient(upstream);
}

export function getRemoteBootstrap(): RemoteControlBootstrap {
  const session = requireRoomSession();
  const bootstrap = createRemoteControlBootstrap({ roomConfig: session.roomConfig, joinContext: session.joinContext });
  if (!bootstrap) throw new Error("Room config is incomplete");
  return bootstrap;
}

export function getRemoteSignalStartContext() {
  const session = requireRoomSession();
  return { roomConfig: session.roomConfig, joinContext: session.joinContext };
}

function requireRoomSession() {
  const session = getRoomSession();
  if (!session) throw new Error("Join a room before starting remote control");
  return session;
}
