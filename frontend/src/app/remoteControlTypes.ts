import type { AuthStatus } from "@uurc/shared/authState";
import type { UuDeviceGroups } from "@uurc/shared/devices";
import type { RemoteControlBootstrap } from "@uurc/shared/remoteBootstrap";
import type { RemoteAssistanceControlMode, RoomJoinKind, RoomJoinResult } from "@uurc/shared/roomSession";

import type { BrowserRemoteVideoElementSample } from "../remote/browserRemoteSessionTypes.js";

export type BusyAction =
  | "status"
  | "import"
  | "send-mobile-code"
  | "mobile-login"
  | "devices"
  | "assistance"
  | "join"
  | "logout"
  | "signal-start"
  | "signal-stop"
  | "browser-remote-start"
  | "reconnect"
  | "clipboard-read"
  | "signal-events"
  | null;

export type SdpTransportMode = "gzip" | "plain";
export type ConnectionRouteMode = "auto" | "relay";
// 信令通道:浏览器直连(经扩展注入握手 header)或部署侧网关转发;auto 优先直连、失败回退网关
export type SignalChannelMode = "auto" | "gateway" | "direct";
export type RemoteStageViewMode = "fit" | "fill";
export type RemoteAudioPlaybackState = "idle" | "waiting" | "playing" | "blocked" | "error";

export type RoomJoinContext = {
  kind: RoomJoinKind;
  deviceId: string;
  forceJoin: boolean;
  occupiedAtJoin: boolean;
  connectId?: string;
  connectCodeProvided?: boolean;
  controlId?: string;
  controlMode?: RemoteAssistanceControlMode | null;
  deviceName?: string;
  targetPlatform?: number;
};

export interface RemoteControlHandoff {
  roomResponse: RoomJoinResult;
  roomJoinContext: RoomJoinContext;
  remoteBootstrap: RemoteControlBootstrap;
}

export interface RemoteControlContext {
  authStatus: AuthStatus | null;
  devices: UuDeviceGroups;
  devicesLoaded: boolean;
  handoff: RemoteControlHandoff | null;
  onDevicesChange: (devices: UuDeviceGroups) => void;
  onControlLeave: () => void;
}

export type RemoteVideoStream = {
  id: string;
  stream: MediaStream;
};

export type RemoteVideoSourceInfo = {
  id: string;
  index: number;
  resolution: string;
  hasSignal: boolean;
};

type RemoteConnectionQualityState = "pending" | "good" | "warn" | "bad";

export type RemoteConnectionQuality = {
  state: RemoteConnectionQualityState;
  title: string;
  detail: string;
  metrics: RemoteConnectionQualityMetric[];
};

export type RemoteConnectionQualityMetric = {
  label: string;
  value: string;
};

export type NextAction = {
  label: string;
  detail: string;
  disabled: boolean;
};

export type RemoteVideoSamplesById = Record<string, BrowserRemoteVideoElementSample>;

export const SELF_DEVICE_BLOCKED_REASON = "不能控制当前设备。";
