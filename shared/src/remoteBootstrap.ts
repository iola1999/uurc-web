import { STREAMER_CLIENT_TYPES, STREAMER_CONTROL_CONNECT_TYPES } from "./streamer/connectOptionsModel.js";
import {
  STREAMER_APP_CLIENT_VERSION,
  STREAMER_CAPTURE_PARAM_DEFAULTS,
  STREAMER_CAPTURE_PARAM_FIELDS,
  STREAMER_CAPTURE_TYPES,
  STREAMER_CHOOSE_RESOLUTION_TYPES,
  STREAMER_CHROMA_FORMATS,
  STREAMER_CONNECT_OPTIONS_FIELDS,
  STREAMER_DEFAULT_FEATURE_FLAGS,
  STREAMER_FPS_VALUES,
  STREAMER_SCREEN_RESOLUTION_FIELDS,
  STREAMER_VIDEO_QUALITY_VALUES,
} from "./streamer/internal/connectOptionsSchema.js";
import { STREAMER_CONTROL_STREAMER_DATA_JSON_KEYS } from "./streamer/internal/controlConfigSchema.js";
import { STREAMER_SEND_TO_ROM_WIRE_FIELDS } from "./streamer/internal/controlChannelSchema.js";
import {
  STREAMER_INPUT_MANAGER_IME_CONTROL_CODES,
  STREAMER_INPUT_MANAGER_TOUCH_SLOTS,
  STREAMER_MUMU_SYSTEM_KEY_CODES,
} from "./streamer/internal/inputLegacy.js";
import {
  STREAMER_CONTROL_EVENT_PAYLOAD_KEYS,
  STREAMER_CONTROL_EVENT_PAYLOAD_TYPES,
  STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER,
  STREAMER_CONTROLLER_OUTBOUND_SOAC_TYPES,
  STREAMER_SOAC_PAYLOAD_KEYS,
} from "./streamer/internal/signalSchema.js";
import {
  STREAMER_CONTROLLER_INBOUND_SOAC_TYPES,
  STREAMER_SOAC_EVENT,
  STREAMER_SOAC_TYPES,
} from "./streamer/signalSoac.js";
import {
  STREAMER_CONTROLLER_SIGNAL_EVENTS,
  STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  STREAMER_CONTROL_EVENT_NAME,
  STREAMER_SIGNAL_SOCKET_EVENTS,
  buildStreamerSignalHeaders,
} from "./streamer/signalSession.js";
import { STREAMER_DATA_CHANNEL_LABELS } from "./streamer/transport.js";
import { summarizeStreamerRoomConfig, type StreamerRoomConfig, type StreamerRoomConfigSummary } from "./roomConfig.js";
import type { RemoteRoomJoinContext } from "./roomSession.js";

export interface RemoteControlBootstrap {
  status: "ready";
  strategy: "backend_signal_gateway";
  selectedSignalServer: string;
  signalServers: string[];
  signalHeaders: Record<string, string>;
  signalEvents: readonly string[];
  soac: {
    event: string;
    types: readonly string[];
    controllerOutboundTypes: readonly string[];
    controllerInboundTypes: readonly string[];
    payloadKeys: readonly string[];
  };
  signalControl: {
    socketEvents: Record<string, string>;
    event: string;
    payloadKeys: readonly string[];
    payloadTypes: Record<string, string>;
    wireArgumentOrder: readonly string[];
    streamerDataJsonKeys: readonly string[];
    ackTimeoutMs: number;
  };
  dataChannels: Record<string, string>;
  connectOptions: {
    fields: readonly { tag: number; name: string; repeated: boolean }[];
    appClientVersion: string;
    clientTypes: Record<string, number>;
    captureTypes: Record<string, number>;
    controlConnectTypes: Record<string, number>;
    defaultFeatureFlags: Record<string, number>;
    captureParams: {
      fields: readonly { tag: number; name: string; defaultValue: unknown }[];
      resolutionFields: readonly { tag: number; name: string; defaultValue: unknown }[];
      fpsValues: Record<string, number>;
      videoQualityValues: Record<string, number>;
      chooseResolutionTypes: Record<string, number>;
      chromaFormats: Record<string, number>;
      staticDefaults: Record<string, unknown>;
    };
  };
  input: {
    supportedBuilders: readonly string[];
    sendToRomWireFields: Record<string, number>;
    imeControlCodes: Record<string, number>;
    mumuSystemKeyCodes: Record<string, number>;
    touchSlots: readonly number[];
  };
  joinContext?: RemoteRoomJoinContext;
  roomConfigSummary: StreamerRoomConfigSummary;
  gatewayRequiredReason: string;
}

export function createRemoteControlBootstrap({
  roomConfig,
  joinContext,
}: {
  roomConfig: StreamerRoomConfig;
  joinContext?: RemoteRoomJoinContext | null;
}): RemoteControlBootstrap | null {
  const roomConfigSummary = summarizeStreamerRoomConfig(roomConfig);
  if (!roomConfigSummary) return null;

  const signalHeaders = buildStreamerSignalHeaders({ token: roomConfig.token });

  return {
    status: "ready",
    strategy: "backend_signal_gateway",
    selectedSignalServer: roomConfig.signalServers[0],
    signalServers: roomConfig.signalServers,
    signalHeaders: {
      ...signalHeaders,
      "X-NRD-AUTH": "<redacted room token>",
    },
    signalEvents: STREAMER_CONTROLLER_SIGNAL_EVENTS,
    soac: {
      event: STREAMER_SOAC_EVENT,
      types: STREAMER_SOAC_TYPES,
      controllerOutboundTypes: STREAMER_CONTROLLER_OUTBOUND_SOAC_TYPES,
      controllerInboundTypes: STREAMER_CONTROLLER_INBOUND_SOAC_TYPES,
      payloadKeys: STREAMER_SOAC_PAYLOAD_KEYS,
    },
    signalControl: {
      socketEvents: STREAMER_SIGNAL_SOCKET_EVENTS,
      event: STREAMER_CONTROL_EVENT_NAME,
      payloadKeys: STREAMER_CONTROL_EVENT_PAYLOAD_KEYS,
      payloadTypes: STREAMER_CONTROL_EVENT_PAYLOAD_TYPES,
      wireArgumentOrder: STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER,
      streamerDataJsonKeys: STREAMER_CONTROL_STREAMER_DATA_JSON_KEYS,
      ackTimeoutMs: STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
    },
    dataChannels: STREAMER_DATA_CHANNEL_LABELS,
    connectOptions: {
      fields: STREAMER_CONNECT_OPTIONS_FIELDS,
      appClientVersion: STREAMER_APP_CLIENT_VERSION,
      clientTypes: STREAMER_CLIENT_TYPES,
      captureTypes: STREAMER_CAPTURE_TYPES,
      controlConnectTypes: STREAMER_CONTROL_CONNECT_TYPES,
      defaultFeatureFlags: STREAMER_DEFAULT_FEATURE_FLAGS,
      captureParams: {
        fields: STREAMER_CAPTURE_PARAM_FIELDS,
        resolutionFields: STREAMER_SCREEN_RESOLUTION_FIELDS,
        fpsValues: STREAMER_FPS_VALUES,
        videoQualityValues: STREAMER_VIDEO_QUALITY_VALUES,
        chooseResolutionTypes: STREAMER_CHOOSE_RESOLUTION_TYPES,
        chromaFormats: STREAMER_CHROMA_FORMATS,
        staticDefaults: STREAMER_CAPTURE_PARAM_DEFAULTS,
      },
    },
    input: {
      supportedBuilders: [
        "desktop_mouse",
        "desktop_keyboard",
        "ime_text",
        "ime_control",
        "mumu_system_key",
        "mumu_touch",
      ],
      sendToRomWireFields: STREAMER_SEND_TO_ROM_WIRE_FIELDS,
      imeControlCodes: STREAMER_INPUT_MANAGER_IME_CONTROL_CODES,
      mumuSystemKeyCodes: STREAMER_MUMU_SYSTEM_KEY_CODES,
      touchSlots: STREAMER_INPUT_MANAGER_TOUCH_SLOTS,
    },
    joinContext: joinContext ?? undefined,
    roomConfigSummary,
    gatewayRequiredReason:
      "Upstream signal connect requires custom socket.io headers on the WebSocket handshake. Browsers can only set them through the companion Direct Signal extension (extension/); without it, signaling goes through this gateway.",
  };
}
