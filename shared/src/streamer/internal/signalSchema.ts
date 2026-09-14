export const STREAMER_CONTROL_EVENT_PAYLOAD_KEYS = ["app_control_id", "app_data", "streamer_data"] as const;

export const STREAMER_CONTROL_EVENT_PAYLOAD_TYPES = {
  app_control_id: "string",
  app_data: "binary",
  streamer_data: "string",
} as const;

export const STREAMER_CONTROL_EVENT_WIRE_ARGUMENT_ORDER = ["app_control_id", "app_data", "streamer_data"] as const;

export const STREAMER_CONTROL_RESULT_KEYS = [
  "client_id",
  "ice_id",
  "iceServers",
  "app_data",
  "streamer_data",
  "app_control_id",
  "controller_platform",
  "force_relay",
  "auto_switch_network",
  "relay_ins_type",
  "force_auto_switch_pkt_loss",
  "force_auto_switch_latency",
  "possible_auto_switch_pkt_loss",
  "possible_auto_switch_latency",
  "code",
  "msg",
] as const;

export const STREAMER_CONTROL_RESULT_ICE_SERVER_KEYS = ["urls", "username", "credential"] as const;

export const STREAMER_SIGNAL_HEADER_KEYS = [
  "X-NRD-AUTH",
  "X-NRD-CONTROLLING",
  "streamer_version",
  "streamer_flag",
] as const;

export const STREAMER_CLIENT_VERSION = "V4.6.0" as const;

export const STREAMER_DEFAULT_SIGNAL_HEADER_VALUES = {
  "X-NRD-CONTROLLING": "0",
  streamer_version: STREAMER_CLIENT_VERSION,
} as const;

export const STREAMER_SOAC_PAYLOAD_KEYS = [
  "type",
  "sdp",
  "ice_id",
  "app_control_id",
  "gzip_sdp",
  "ice_network_type",
  "candidate",
  "sdpMid",
  "sdpMLineIndex",
] as const;

export const STREAMER_SOAC_MESSAGE_KEYS = ["client_id", "data"] as const;

export const STREAMER_CONTROLLER_OUTBOUND_SOAC_TYPES = ["offer", "candidate", "restart_ice"] as const;
