import type { UuDevice, UuDeviceGroups } from "@uurc/shared/devices";
import type { RemoteControlBootstrap } from "@uurc/shared/remoteBootstrap";
import type { RemoteSignalGatewayEvent, RemoteSignalGatewayStatus } from "@uurc/shared/signalGateway/model";
import type { RemoteSignalReadinessDiagnostics } from "@uurc/shared/streamer/readiness";
import type { RoomJoinResult } from "@uurc/shared/roomSession";

import type { BusyAction, ConnectionRouteMode, RoomJoinContext, SdpTransportMode } from "../app/remoteControlTypes.js";
import type { BrowserRemoteSessionState } from "./browserRemoteSessionTypes.js";
import { getRemoteConnectionQuality } from "./remoteConnectionQuality.js";
import {
  formatRoomJoinContext,
  formatRoomReleaseDetail,
  formatRoomReleaseState,
  getRoomJoinFailureMessage,
  summarizeRoomJoinUpstream,
} from "./remoteRoomUiModel.js";
import {
  formatAudioElement,
  formatBrowserRemoteStage,
  formatConnectionPath,
  formatDataChannelState,
  formatInboundAudioStats,
  formatInboundVideoStats,
  formatVideoElement,
  formatVideoFlow,
  getNextAction,
} from "./remoteSessionUiModel.js";
import {
  formatAutoSwitchThresholds,
  formatSignalGatewayErrorHint,
  formatSignalGatewayState,
  summarizeSwitchNetworkNotify,
  summarizeUnexpectedSignalEvents,
} from "./remoteSignalUiModel.js";

interface RemoteControlPresentationInput {
  authDeviceId: string | undefined;
  autoReconnectEnabled: boolean;
  autoReconnectStatus: string;
  browserRemoteState: BrowserRemoteSessionState;
  browserWebRtcUnavailableReason: string;
  busy: BusyAction;
  connectionRouteMode: ConnectionRouteMode;
  controlChannelState: RTCDataChannelState;
  decodeStalledStreak: number;
  devices: UuDeviceGroups;
  devicesLoaded: boolean;
  forceJoin: boolean;
  inputControlActive: boolean;
  localSignalReadiness: RemoteSignalReadinessDiagnostics;
  remoteBootstrap: RemoteControlBootstrap | null;
  remoteSignalDiagnostics: RemoteSignalReadinessDiagnostics | null;
  remoteVideoCount: number;
  roomJoinContext: RoomJoinContext | null;
  roomResponse: RoomJoinResult | null;
  sdpTransportMode: SdpTransportMode;
  selectedDevice: UuDevice | null;
  selectedDeviceId: string;
  selectedDeviceOccupied: boolean;
  signalEvents: RemoteSignalGatewayEvent[];
  signalGatewayContext: RoomJoinContext | null;
  signalGatewayStatus: RemoteSignalGatewayStatus | null;
  textChannelState: RTCDataChannelState;
}

export function createRemoteControlPresentation(input: RemoteControlPresentationInput) {
  const signalReadiness = input.remoteSignalDiagnostics ?? input.localSignalReadiness;
  const signalGatewayState = input.signalGatewayStatus?.status ?? "idle";
  const activeSignalHeaders = input.signalGatewayStatus?.signalHeaders ?? input.remoteBootstrap?.signalHeaders;
  const signalHeaderSummary = activeSignalHeaders
    ? Object.entries(activeSignalHeaders)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")
    : "-";
  const roomJoinFailureMessage = getRoomJoinFailureMessage(input.roomResponse);
  const selectedDeviceIsCurrentAuthDevice = Boolean(
    input.authDeviceId && input.selectedDeviceId && input.selectedDeviceId === input.authDeviceId,
  );
  const roomJoinedForSelectedDevice =
    input.roomJoinContext?.deviceId === input.selectedDeviceId && Boolean(input.roomResponse?.roomConfigSummary);
  const roomRequiresTakeover =
    roomJoinedForSelectedDevice && input.roomJoinContext?.occupiedAtJoin === true && !input.roomJoinContext.forceJoin;
  const signalGatewayMatchesRoom =
    signalGatewayState === "connected" &&
    input.signalGatewayContext?.deviceId === input.roomJoinContext?.deviceId &&
    input.signalGatewayContext?.forceJoin === input.roomJoinContext?.forceJoin &&
    (input.signalGatewayContext?.kind ?? "owned_device") === (input.roomJoinContext?.kind ?? "owned_device");
  const roomReadyForBrowserRtc = roomJoinedForSelectedDevice && !roomRequiresTakeover && signalGatewayMatchesRoom;
  const browserRtcBlockedReason = selectedDeviceIsCurrentAuthDevice
    ? "不能控制当前设备。"
    : roomJoinFailureMessage ||
      (!roomJoinedForSelectedDevice
        ? "请先加入房间"
        : roomRequiresTakeover
          ? "选择接管后重试"
          : !signalGatewayMatchesRoom
            ? "重新连接"
            : "");
  const normalJoinLeftBeforeAnswer =
    input.roomJoinContext?.forceJoin === false &&
    signalReadiness.blocker === "controlled_left_before_answer" &&
    signalReadiness.checks.offerSent &&
    !signalReadiness.checks.answerReceived;
  const normalJoinTakeoverHint = normalJoinLeftBeforeAnswer ? "画面未返回。" : "";
  const browserRtcReady = roomReadyForBrowserRtc && input.busy === null && !input.browserWebRtcUnavailableReason;
  const connectionPathLabel = formatConnectionPath(input.browserRemoteState.connectionPath);
  const controlChannelLabel = formatDataChannelState(input.controlChannelState);
  const inputControlLabel = input.inputControlActive
    ? "控制中"
    : input.controlChannelState === "open"
      ? "仅查看"
      : controlChannelLabel;
  const videoFlowStatus = input.browserRemoteState.videoFlow?.status;
  const decodeStalledPersisted =
    (videoFlowStatus === "decode_stalled" || videoFlowStatus === "presentation_stalled") &&
    input.decodeStalledStreak >= 2;
  const browserConnectionRecoverable =
    Boolean(input.browserRemoteState.failureReason) ||
    (input.browserRemoteState.stage === "connected" &&
      (input.controlChannelState === "closed" || videoFlowStatus === "transport_stalled" || decodeStalledPersisted));
  const remoteRecoveryLabel =
    input.browserRemoteState.failureReason ||
    (browserConnectionRecoverable
      ? input.controlChannelState === "closed"
        ? "控制连接已断开"
        : decodeStalledPersisted
          ? videoFlowStatus === "presentation_stalled"
            ? "画面卡顿（浏览器呈现异常）"
            : "画面卡顿（解码异常）"
          : "画面中断（网络）"
      : "");
  const autoReconnectLabel =
    browserConnectionRecoverable && input.autoReconnectEnabled
      ? input.autoReconnectStatus || "自动重连准备中"
      : input.autoReconnectEnabled
        ? "自动重连已开启"
        : "自动重连已关闭";
  const connectionQuality = getRemoteConnectionQuality({
    state: input.browserRemoteState,
    controlChannelState: input.controlChannelState,
    inputControlActive: input.inputControlActive,
    textChannelState: input.textChannelState,
    connectionPathLabel,
  });
  const selectedCandidatePair = input.browserRemoteState.selectedCandidatePair;
  const connectionRouteLabel = input.connectionRouteMode === "relay" ? "强制中转" : "自动路径";
  const effectiveConnectionRouteLabel =
    input.connectionRouteMode === "relay"
      ? "强制中转"
      : input.browserRemoteState.controlResult?.forceRelay
        ? "服务端要求中转"
        : connectionRouteLabel;
  const serviceRoutePolicyLabel = input.browserRemoteState.controlResult?.forceRelay
    ? "服务端要求中转"
    : input.browserRemoteState.controlResult?.autoSwitchNetwork
      ? "服务端自动切换"
      : "-";
  const iceControlStatusLabel = input.browserRemoteState.controlResultIceId
    ? input.browserRemoteState.controlIceIdMatch === undefined
      ? "使用 ack ICE"
      : input.browserRemoteState.controlIceIdMatch
        ? "ack ICE 已对齐"
        : "ack ICE 覆盖本地候选"
    : input.browserRemoteState.iceId
      ? "ICE 等待 ack"
      : "-";
  const selectedTargetLabel =
    input.roomJoinContext?.kind === "remote_assistance"
      ? (input.roomJoinContext.deviceName ??
        `远程协助 ${input.roomJoinContext.connectId ?? input.roomJoinContext.deviceId}`)
      : (input.selectedDevice?.alias ?? "远控画面");
  const hasRemoteVideo = input.remoteVideoCount > 0;
  const canDisconnectRemote =
    signalGatewayState === "connected" ||
    input.browserRemoteState.stage !== "idle" ||
    hasRemoteVideo ||
    input.controlChannelState !== "closed" ||
    input.textChannelState !== "closed";
  const remoteAssistanceActive = input.roomJoinContext?.kind === "remote_assistance";
  const deviceTotal =
    input.devices.desktopDevices.length + input.devices.mobileDevices.length + input.devices.tvDevices.length;
  const nextAction = getNextAction({
    busy: input.busy,
    browserConnectionRecoverable,
    controlChannelState: input.controlChannelState,
    deviceTotal,
    inputControlActive: input.inputControlActive,
    loggedIn: Boolean(input.authDeviceId),
    roomJoinedForSelectedDevice,
    remoteAssistanceTarget: remoteAssistanceActive,
    roomRequiresTakeover,
    selectedDeviceId: input.selectedDeviceId,
    selectedDeviceIsCurrentAuthDevice,
    signalGatewayErrored: signalGatewayState === "error",
    signalGatewayMatchesRoom,
    browserStage: input.browserRemoteState.stage,
    forceJoin: input.forceJoin,
  });
  const stageStatusLabel =
    input.browserRemoteState.stage === "connected"
      ? "已连接"
      : input.browserRemoteState.remoteTrackCount > 0
        ? "正在加载画面…"
        : signalGatewayState === "connected" || input.busy === "signal-start" || input.busy === "browser-remote-start"
          ? "连接中…"
          : input.selectedDeviceOccupied && !input.forceJoin
            ? "设备被占用，点「接管并开始连接」"
            : input.roomResponse || input.remoteBootstrap
              ? "已就绪，点「开始连接」"
              : "未连接";

  return {
    audioPlaybackLabel: formatAudioElement(input.browserRemoteState.audioElement),
    autoReconnectLabel,
    autoSwitchThresholdLabel: formatAutoSwitchThresholds(input.browserRemoteState.controlResult),
    browserConnectionRecoverable,
    browserIceServers: input.browserRemoteState.controlResult?.iceServers.length ?? 0,
    browserRtcBlockedReason,
    browserRtcReady,
    browserStageLabel: formatBrowserRemoteStage(input.browserRemoteState.stage),
    canDisconnectRemote,
    candidatePairSummary: selectedCandidatePair
      ? `${selectedCandidatePair.localCandidateType ?? "-"} -> ${selectedCandidatePair.remoteCandidateType ?? "-"}`
      : "-",
    connectionPathLabel,
    connectionQuality,
    controlChannelLabel,
    deviceNotFound:
      Boolean(input.authDeviceId) &&
      input.devicesLoaded &&
      Boolean(input.selectedDeviceId) &&
      !input.selectedDevice &&
      !remoteAssistanceActive,
    effectiveConnectionRouteLabel,
    hasRemoteVideo,
    iceControlStatusLabel,
    inboundAudioStatsLabel: formatInboundAudioStats(input.browserRemoteState.inboundAudio),
    inboundVideoStatsLabel: formatInboundVideoStats(input.browserRemoteState.inboundVideo),
    inputControlLabel,
    joinModeLabel: input.forceJoin ? "接管控制" : "普通加入",
    networkSwitchSummary: summarizeSwitchNetworkNotify(input.signalEvents),
    nextAction,
    normalJoinTakeoverHint,
    remoteAssistanceActive,
    remoteRecoveryLabel,
    roomDebugPayload: input.roomResponse
      ? {
          upstream: summarizeRoomJoinUpstream(input.roomResponse.upstream),
          roomConfigSummary: input.roomResponse.roomConfigSummary,
          sessionReference: input.roomResponse.sessionReference,
          remoteBootstrap: input.remoteBootstrap,
          signalGatewayStatus: input.signalGatewayStatus,
          remoteSignalDiagnostics: input.remoteSignalDiagnostics,
          roomJoinContext: input.roomJoinContext,
          signalGatewayContext: input.signalGatewayContext,
        }
      : null,
    roomJoinedForSelectedDevice,
    roomJoinFailureMessage,
    roomJoinModeDebugLabel: formatRoomJoinContext(input.remoteBootstrap?.joinContext),
    roomReadyForBrowserRtc,
    roomReleaseDetail: formatRoomReleaseDetail(input.signalGatewayStatus, input.roomJoinContext),
    roomReleaseLabel: formatRoomReleaseState(
      input.signalGatewayStatus,
      canDisconnectRemote,
      input.selectedDeviceOccupied,
      input.roomJoinContext,
    ),
    roomRequiresTakeover,
    sdpTransportLabel: input.sdpTransportMode === "gzip" ? "gzip_sdp" : "plain_sdp",
    selectedDeviceIsCurrentAuthDevice,
    selectedTargetLabel,
    serviceRoutePolicyLabel,
    signalGatewayDisplay: formatSignalGatewayState(signalGatewayState),
    signalGatewayErrorHint: formatSignalGatewayErrorHint(input.signalGatewayStatus),
    signalGatewayMatchesRoom,
    signalGatewayState,
    signalHeaderSummary,
    signalReadiness,
    signalServerOptions: input.remoteBootstrap?.signalServers ?? [],
    stageStatusLabel,
    textChannelLabel: formatDataChannelState(input.textChannelState),
    unexpectedSignalEventSummary: summarizeUnexpectedSignalEvents(
      input.signalEvents,
      input.remoteBootstrap?.signalEvents ?? [],
    ),
    videoElementLabel: formatVideoElement(input.browserRemoteState.videoElement),
    videoFlowLabel: formatVideoFlow(input.browserRemoteState),
  };
}
