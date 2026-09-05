import type { Dispatch, SetStateAction } from "react";

import type { UuDevice, UuDeviceGroups } from "@uurc/shared/devices";
import type { RemoteControlBootstrap } from "@uurc/shared/remoteBootstrap";
import type { RemoteSignalGatewayStatus } from "@uurc/shared/signalGateway/model";
import type { RemoteSignalReadinessDiagnostics } from "@uurc/shared/streamer/readiness";
import type { RoomJoinResult } from "@uurc/shared/roomSession";

import type { BusyAction, RoomJoinContext } from "../app/remoteControlTypes.js";
import { SELF_DEVICE_BLOCKED_REASON } from "../app/remoteControlTypes.js";
import {
  getRemoteSignalDiagnostics,
  startRemoteSignalGateway,
  stopRemoteSignalGateway,
} from "../api/remoteSignalApi.js";
import { cancelRemoteAssistance } from "../uu/remoteAssistanceApi.js";
import { clearRoomByDevice, getDeviceGroups, getRemoteBootstrap, joinRoomByDevice } from "../uu/roomApi.js";
import { clearRoomSession } from "../uu/roomSessionStore.js";

let pendingRelease: Promise<RemoteSignalGatewayStatus> | null = null;
let pendingJoin: Promise<RoomJoinResult | null> | null = null;

export async function waitForRoomRelease(): Promise<void> {
  // 先让上一页面的卸载清理登记，再等待其请求结束。
  await Promise.resolve();
  await pendingJoin?.catch(() => undefined);
  await pendingRelease?.catch(() => undefined);
}

export function releaseRemoteRoom(context: RoomJoinContext): Promise<RemoteSignalGatewayStatus> {
  if (pendingRelease) return pendingRelease;
  pendingRelease = (async () => {
    const [stopped, released] = await Promise.allSettled([
      stopRemoteSignalGateway(),
      context.kind === "remote_assistance"
        ? cancelRemoteAssistance(context.connectId ?? context.deviceId)
        : clearRoomByDevice(context.deviceId),
    ]);
    clearRoomSession();
    if (stopped.status === "rejected") throw stopped.reason;
    return {
      ...stopped.value,
      ...(released.status === "fulfilled"
        ? { roomClear: released.value }
        : { roomClearError: released.reason instanceof Error ? released.reason.message : String(released.reason) }),
    };
  })().finally(() => {
    pendingRelease = null;
  });
  return pendingRelease;
}

type RunAction = (action: Exclude<BusyAction, null>, task: () => Promise<void>) => Promise<boolean>;

interface RemoteRoomLifecycleOptions {
  allDevices: UuDevice[];
  authDeviceId: string | undefined;
  forceJoin: boolean;
  selectedDeviceId: string;
  sdpTransportMode: "gzip" | "plain";
  signalServerIndex: number;
  roomJoinContext: RoomJoinContext | null;
  isActive?(): boolean;
  run: RunAction;
  onDevicesChange(devices: UuDeviceGroups): void;
  onForceJoinChange(forceJoin: boolean): void;
  resetBrowserRemoteSession(): void;
  resetSignalEvents(): void;
  resetSignalGateway(): void;
  setRemoteBootstrap: Dispatch<SetStateAction<RemoteControlBootstrap | null>>;
  setRemoteSignalDiagnostics: Dispatch<SetStateAction<RemoteSignalReadinessDiagnostics | null>>;
  setRoomJoinContext: Dispatch<SetStateAction<RoomJoinContext | null>>;
  setRoomResponse: Dispatch<SetStateAction<RoomJoinResult | null>>;
  setSignalGatewayContext: Dispatch<SetStateAction<RoomJoinContext | null>>;
  setSignalGatewayStatus: Dispatch<SetStateAction<RemoteSignalGatewayStatus | null>>;
  showToast(message: string): void;
}

export function createRemoteRoomLifecycle(options: RemoteRoomLifecycleOptions) {
  async function joinRoomForDevice(
    deviceId: string,
    joinWithForce = options.forceJoin,
  ): Promise<RoomJoinContext | null> {
    if (!deviceId) return null;
    let nextContext: RoomJoinContext | null = null;
    await options.run("join", async () => {
      await waitForRoomRelease();
      if (options.isActive?.() === false) return;
      if (deviceId === options.authDeviceId) throw new Error(SELF_DEVICE_BLOCKED_REASON);
      const device = options.allDevices.find((item) => item.deviceId === deviceId) ?? null;
      const context: RoomJoinContext = {
        kind: "owned_device",
        deviceId,
        forceJoin: joinWithForce,
        occupiedAtJoin: (device?.participantsInfo?.length ?? 0) > 0,
      };
      const joining = joinRoomByDevice(deviceId, joinWithForce).then(async (joined) => {
        if (options.isActive?.() === false) {
          await releaseRemoteRoom(context);
          return null;
        }
        return joined;
      });
      pendingJoin = joining;
      let joined;
      try {
        joined = await joining;
      } finally {
        if (pendingJoin === joining) pendingJoin = null;
      }
      if (!joined) return;
      options.setRoomResponse(joined);
      options.setRoomJoinContext(context);
      options.onForceJoinChange(joinWithForce);
      options.resetSignalGateway();
      options.resetBrowserRemoteSession();
      options.setRemoteBootstrap(joined.roomConfigSummary ? await getRemoteBootstrap() : null);
      if (joined.roomConfigSummary) nextContext = context;
    });
    return nextContext;
  }

  async function startSignalGateway(context = options.roomJoinContext): Promise<RemoteSignalGatewayStatus | null> {
    let nextStatus: RemoteSignalGatewayStatus | null = null;
    await options.run("signal-start", async () => {
      await waitForRoomRelease();
      if (options.isActive?.() === false) return;
      if (!context || context.deviceId !== options.selectedDeviceId) throw new Error("请先加入房间");
      options.resetSignalEvents();
      const status = await startRemoteSignalGateway({
        gzipSdp: options.sdpTransportMode === "gzip",
        signalServerIndex: options.signalServerIndex > 0 ? options.signalServerIndex : undefined,
      });
      if (options.isActive?.() === false) return;
      nextStatus = status;
      options.setSignalGatewayStatus(status);
      options.setSignalGatewayContext(status.status === "connected" ? context : null);
      options.setRemoteSignalDiagnostics(await getRemoteSignalDiagnostics());
    });
    return nextStatus;
  }

  async function stopSignalGateway(): Promise<void> {
    await options.run("signal-stop", async () => {
      options.resetBrowserRemoteSession();
      const clearContext = options.roomJoinContext;
      options.setRoomResponse(null);
      options.setRoomJoinContext(null);
      options.setRemoteBootstrap(null);
      options.setSignalGatewayContext(null);
      options.resetSignalEvents();
      const nextStatus = clearContext ? await releaseRemoteRoom(clearContext) : await stopRemoteSignalGateway();
      options.setSignalGatewayStatus(nextStatus);
      options.setSignalGatewayContext(null);
      options.resetSignalEvents();
      options.showToast("已断开远控连接");
      if (clearContext?.kind !== "remote_assistance") {
        try {
          options.onDevicesChange(await getDeviceGroups());
        } catch {
          // The active connection is already closed; a refresh failure must not undo that result.
        }
      }
    });
  }

  return { joinRoomForDevice, startSignalGateway, stopSignalGateway };
}
