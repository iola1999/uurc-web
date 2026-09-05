import type { StreamerRoomConfig } from "../roomConfig.js";
import { STREAMER_CONTROL_STREAMER_DATA_JSON_KEYS } from "../streamer/internal/controlConfigSchema.js";
import {
  STREAMER_CONTROL_EVENT_PAYLOAD_KEYS,
  STREAMER_CONTROL_EVENT_PAYLOAD_TYPES,
  STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER,
} from "../streamer/internal/signalSchema.js";
import {
  STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  STREAMER_CONTROL_EVENT_NAME,
  STREAMER_SIGNAL_SOCKET_EVENTS,
} from "../streamer/signalSession.js";
import type { RemoteSignalGatewayStatus } from "./model.js";

export const SIGNAL_GATEWAY_MAX_EVENTS = 200;
export const SIGNAL_MAX_FRAME_BYTES = 1024 * 1024;
export const SIGNAL_MAX_SDP_BYTES = 1024 * 1024;
export const SIGNAL_MAX_EVENT_BYTES = 2 * 1024 * 1024;
export const SIGNAL_GATEWAY_EVENT_RETENTION_MS = 15 * 60 * 1000;

export function orderSignalGatewayServers(signalServers: string[], preferredIndex: number | undefined): string[] {
  if (
    preferredIndex === undefined ||
    !Number.isInteger(preferredIndex) ||
    preferredIndex < 0 ||
    preferredIndex >= signalServers.length
  ) {
    return signalServers;
  }
  return [
    signalServers[preferredIndex],
    ...signalServers.slice(0, preferredIndex),
    ...signalServers.slice(preferredIndex + 1),
  ];
}

export function createIdleSignalGatewayStatus(updatedAt = new Date().toISOString()): RemoteSignalGatewayStatus {
  return {
    status: "idle",
    strategy: "backend_signal_gateway",
    signalServers: [],
    signalHeaders: {},
    signalControl: buildSignalGatewayControlStatus(),
    updatedAt,
  };
}

export function createSignalGatewayStatus({
  status,
  roomConfig,
  rawHeaders,
  startedAt,
  connectionId,
  error,
  selectedSignalServer,
  updatedAt = new Date().toISOString(),
}: {
  status: RemoteSignalGatewayStatus["status"];
  roomConfig: StreamerRoomConfig;
  rawHeaders: Record<string, string>;
  startedAt: string;
  connectionId?: string;
  error?: string;
  selectedSignalServer?: string;
  updatedAt?: string;
}): RemoteSignalGatewayStatus {
  return {
    status,
    strategy: "backend_signal_gateway",
    selectedSignalServer: selectedSignalServer ?? roomConfig.signalServers[0],
    signalServers: roomConfig.signalServers,
    signalHeaders: redactSignalGatewayHeaders(rawHeaders),
    signalControl: buildSignalGatewayControlStatus(),
    connectionId,
    startedAt,
    updatedAt,
    error,
  };
}

function buildSignalGatewayControlStatus(): RemoteSignalGatewayStatus["signalControl"] {
  return {
    socketEvents: STREAMER_SIGNAL_SOCKET_EVENTS,
    event: STREAMER_CONTROL_EVENT_NAME,
    payloadKeys: STREAMER_CONTROL_EVENT_PAYLOAD_KEYS,
    payloadTypes: STREAMER_CONTROL_EVENT_PAYLOAD_TYPES,
    wireArgumentOrder: STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER,
    streamerDataJsonKeys: STREAMER_CONTROL_STREAMER_DATA_JSON_KEYS,
    ackTimeoutMs: STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  };
}

function redactSignalGatewayHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...headers, "X-NRD-AUTH": "<redacted room token>" };
}

export function redactSignalGatewayToken(message: string, token: string): string {
  return token ? message.split(token).join("<redacted room token>") : message;
}
