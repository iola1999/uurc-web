import type { UuDevice } from "@uurc/shared/devices";
import type { RemoteControlBootstrap } from "@uurc/shared/remoteBootstrap";
import type { RuntimeProfile } from "@uurc/shared/runtimeProfile";
import type { RemoteSignalGatewayEvent } from "@uurc/shared/signalGateway/model";
import type { RemoteSignalReadinessDiagnostics } from "@uurc/shared/streamer/readiness";

import type { BrowserRemoteDebugEvent, BrowserRemoteSessionState } from "../remote/browserRemoteSessionTypes.js";
import { DebugEventList } from "./DebugEventList.js";
import { formatAppFlagControlMode, getDeviceConnectionLabel } from "../devices/deviceLabels.js";
import { StatusRow } from "./Panel.js";
import { ReadinessStrip } from "./ReadinessStrip.js";
import { AnimatedDisclosure } from "./ui/AnimatedDisclosure.js";

export interface RemoteControlDiagnosticsDrawerProps {
  audioPlaybackLabel: string;
  autoSwitchThresholdLabel: string;
  browserIceServers: number;
  browserRemoteState: BrowserRemoteSessionState;
  browserRtcDescription: string;
  browserStageLabel: string;
  candidatePairSummary: string;
  connectionPathLabel: string;
  controlChannelLabel: string;
  debugEvents: BrowserRemoteDebugEvent[];
  effectiveConnectionRouteLabel: string;
  fingerprintSummary: string;
  iceControlStatusLabel: string;
  inboundAudioStatsLabel: string;
  inboundVideoStatsLabel: string;
  inputControlActive: boolean;
  joinModeLabel: string;
  networkSwitchSummary: string;
  publisherNetworkLabel: string;
  remoteBootstrap: RemoteControlBootstrap | null;
  roomDebugPayload: unknown;
  roomJoinModeDebugLabel: string;
  roomReleaseDetail: string;
  roomReleaseLabel: string;
  routingDecisionLabel: string;
  runtimeProfile: RuntimeProfile | null;
  selectedDevice: UuDevice | null;
  selectedDeviceId: string;
  serviceRoutePolicyLabel: string;
  signalEventDump: string;
  signalEvents: RemoteSignalGatewayEvent[];
  signalGatewayDisplay: string;
  signalHeaderSummary: string;
  signalReadiness: RemoteSignalReadinessDiagnostics;
  sdpTransportLabel: string;
  subscriberNetworkLabel: string;
  textChannelLabel: string;
  unexpectedSignalEventSummary: string;
  videoElementLabel: string;
  videoFlowLabel: string;
}

export function RemoteControlDiagnosticsDrawer({
  audioPlaybackLabel,
  autoSwitchThresholdLabel,
  browserIceServers,
  browserRemoteState,
  browserRtcDescription,
  browserStageLabel,
  candidatePairSummary,
  connectionPathLabel,
  controlChannelLabel,
  debugEvents,
  effectiveConnectionRouteLabel,
  fingerprintSummary,
  iceControlStatusLabel,
  inboundAudioStatsLabel,
  inboundVideoStatsLabel,
  inputControlActive,
  joinModeLabel,
  networkSwitchSummary,
  publisherNetworkLabel,
  remoteBootstrap,
  roomDebugPayload,
  roomJoinModeDebugLabel,
  roomReleaseDetail,
  roomReleaseLabel,
  routingDecisionLabel,
  runtimeProfile,
  selectedDevice,
  selectedDeviceId,
  serviceRoutePolicyLabel,
  signalEventDump,
  signalEvents,
  signalGatewayDisplay,
  signalHeaderSummary,
  signalReadiness,
  sdpTransportLabel,
  subscriberNetworkLabel,
  textChannelLabel,
  unexpectedSignalEventSummary,
  videoElementLabel,
  videoFlowLabel,
}: RemoteControlDiagnosticsDrawerProps) {
  return (
    <AnimatedDisclosure className="control-drawer" contentClassName="control-drawer-content" summary="调试信息">
      <div className="status-list compact">
        <StatusRow label="目标设备" value={selectedDevice?.alias ?? "-"} />
        <StatusRow label="目标 ID" value={selectedDeviceId || "-"} />
        <StatusRow label="在线状态" value={selectedDevice ? getDeviceConnectionLabel(selectedDevice) : "-"} />
        <StatusRow label="控制模式" value={selectedDevice ? formatAppFlagControlMode(selectedDevice.appFlag) : "-"} />
        <StatusRow label="加入模式" value={joinModeLabel} />
        <StatusRow label="入会方式" value={roomJoinModeDebugLabel} />
        <StatusRow label="连接服务" value={signalGatewayDisplay} />
        <StatusRow label="信令状态" value={signalGatewayDisplay} />
        <StatusRow label="浏览器控制" value={browserRtcDescription} />
        <StatusRow label="实际路径" value={connectionPathLabel} />
        <StatusRow label="候选链路" value={candidatePairSummary} />
        <StatusRow label="链路策略" value={effectiveConnectionRouteLabel} />
        <StatusRow label="服务链路" value={serviceRoutePolicyLabel} />
        <StatusRow label="服务端路由" value={routingDecisionLabel} />
        <StatusRow label="被控端网络" value={publisherNetworkLabel} />
        <StatusRow label="控制端网络" value={subscriberNetworkLabel} />
        <StatusRow
          label="部署运行时"
          value={runtimeProfile ? `${runtimeProfile.runtime} · ${runtimeProfile.signalGateway}` : "-"}
        />
        <StatusRow label="当前指纹" value={fingerprintSummary} />
        <StatusRow label="ICE" value={iceControlStatusLabel} />
        <StatusRow label="自动切换" value={autoSwitchThresholdLabel} />
        <StatusRow label="网络事件" value={networkSwitchSummary} />
        <StatusRow label="视频状态" value={videoFlowLabel} />
        <StatusRow label="视频接收" value={inboundVideoStatsLabel} />
        <StatusRow label="视频采样" value={videoElementLabel} />
        <StatusRow label="音频接收" value={inboundAudioStatsLabel} />
        <StatusRow label="音频播放" value={audioPlaybackLabel} />
        <StatusRow label="控制通道" value={controlChannelLabel} />
        <StatusRow label="文本通道" value={textChannelLabel} />
        <StatusRow label="输入控制" value={inputControlActive ? "控制中" : "仅查看"} />
        <StatusRow label="房间释放" value={roomReleaseLabel} />
        <StatusRow label="释放详情" value={roomReleaseDetail} />
      </div>
      <ReadinessStrip diagnostics={signalReadiness} />
      <AnimatedDisclosure className="protocol-details" contentClassName="protocol-details-content" summary="协议细节">
        <div className="status-list compact transport-details">
          <StatusRow label="Headers" value={signalHeaderSummary} />
          <StatusRow label="事件" value={remoteBootstrap ? remoteBootstrap.signalEvents.join(", ") : "-"} />
          <StatusRow label="事件日志" value={String(signalEvents.length)} />
          <StatusRow label="未知事件" value={unexpectedSignalEventSummary} />
          <StatusRow label="浏览器 WebRTC" value={`${browserStageLabel} / ICE ${browserIceServers}`} />
          <StatusRow label="Peer 连接" value={browserRemoteState.peerConnectionState ?? "-"} />
          <StatusRow label="Peer ICE" value={browserRemoteState.peerIceConnectionState ?? "-"} />
          <StatusRow label="ICE 收集" value={browserRemoteState.peerIceGatheringState ?? "-"} />
          <StatusRow label="SDP 状态" value={browserRemoteState.peerSignalingState ?? "-"} />
          <StatusRow label="SDP" value={sdpTransportLabel} />
          <StatusRow label="链路策略" value={effectiveConnectionRouteLabel} />
          <StatusRow label="Control ID" value={browserRemoteState.appControlId || "-"} />
        </div>
      </AnimatedDisclosure>
      <AnimatedDisclosure className="debug-details" contentClassName="debug-details-content" summary="脱敏调试摘要">
        <pre className="response-box">
          {roomDebugPayload ? JSON.stringify(roomDebugPayload, null, 2) : "No room response yet."}
        </pre>
      </AnimatedDisclosure>
      <AnimatedDisclosure
        className="debug-details"
        contentClassName="debug-details-content"
        summary="信令事件原文（脱敏）"
      >
        <pre className="response-box">{signalEventDump || "暂无信令事件。"}</pre>
      </AnimatedDisclosure>
      <AnimatedDisclosure
        className="debug-events-details"
        contentClassName="debug-events-details-content"
        summary="远控调试日志"
      >
        <DebugEventList events={debugEvents} />
      </AnimatedDisclosure>
    </AnimatedDisclosure>
  );
}
