import type { RemoteRoomJoinContext, RoomJoinUpstreamSummary } from "../roomSession.js";
import type { StreamerRoomConfig } from "../roomConfig.js";
import type { StreamerSignalControlAck } from "../streamer/signalControl.js";
import type { StreamerIceNetworkType } from "../streamer/signalSoac.js";

export type RemoteSignalGatewayState = "idle" | "connecting" | "connected" | "closed" | "error";
export type RemoteSignalGatewayEventDirection = "inbound" | "outbound";

export interface RemoteSignalGatewayBinaryPayload {
  kind: "binary";
  byteLength: number;
  base64: string;
}

export interface RemoteSignalGatewayEvent {
  id: number;
  direction: RemoteSignalGatewayEventDirection;
  event: string;
  receivedAt: string;
  payload: unknown;
}

export interface RemoteSignalGatewayStartRequest {
  gzipSdp?: boolean;
  signalServerIndex?: number;
  streamerVersion?: string;
  roomConfig?: StreamerRoomConfig;
  joinContext?: RemoteRoomJoinContext;
}

export interface RemoteSignalControlRequest {
  appControlId: string;
  appDataBase64?: string;
  streamerData?: string;
}

export interface RemoteSignalControlResult {
  event: string;
  ackStatus?: string;
  ack: unknown[];
  control: StreamerSignalControlAck;
  emittedAt: string;
  ackReceivedAt: string;
}

export interface RemoteSignalSoacCandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export interface RemoteSignalSoacRequest {
  type: "offer" | "answer" | "candidate" | "restart_ice";
  clientId?: string;
  appControlId?: string;
  iceId?: string;
  sdp?: string;
  gzipSdp?: boolean;
  iceNetworkType?: StreamerIceNetworkType;
  candidate?: RemoteSignalSoacCandidate;
}

export interface RemoteSignalSoacResult {
  event: string;
  payload: unknown;
  emittedAt: string;
}

export type RemoteSignalGatewayStrategy = "backend_signal_gateway" | "browser_direct_signal";

export interface RemoteSignalGatewayStatus {
  status: RemoteSignalGatewayState;
  strategy: RemoteSignalGatewayStrategy;
  selectedSignalServer?: string;
  signalServers: string[];
  signalHeaders: Record<string, string>;
  signalControl: {
    socketEvents: Record<string, string>;
    event: string;
    payloadKeys: readonly string[];
    payloadTypes: Record<string, string>;
    wireArgumentOrder: readonly string[];
    streamerDataJsonKeys: readonly string[];
    ackTimeoutMs: number;
  };
  connectionId?: string;
  startedAt?: string;
  updatedAt: string;
  error?: string;
  roomClear?: RoomJoinUpstreamSummary;
  roomClearError?: string;
}
