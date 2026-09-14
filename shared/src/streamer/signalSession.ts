import { STREAMER_SOAC_EVENT } from "./signalSoac.js";
import { STREAMER_CLIENT_VERSION, STREAMER_DEFAULT_SIGNAL_HEADER_VALUES } from "./internal/signalSchema.js";

export const STREAMER_CONTROLLER_SIGNAL_EVENTS = [
  STREAMER_SOAC_EVENT,
  "streamer_push",
  "forward_setting",
  "device_capability",
] as const;

export const STREAMER_SIGNAL_SOCKET_EVENTS = {
  control: "control",
  leave: "leave",
  bmsgPush: "bmsg_push",
  publisherDisconnect: "publisher_disconnect",
} as const;

export const STREAMER_CONTROL_EVENT_NAME = STREAMER_SIGNAL_SOCKET_EVENTS.control;
export const STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS = 10_000;
interface StreamerFlagHeaderOptions {
  gzipSdp: boolean;
}

export interface BuildStreamerSignalHeadersInput {
  token: string;
  gzipSdp?: boolean;
  streamerVersion?: string;
}

function buildStreamerFlagHeader(options: StreamerFlagHeaderOptions): string {
  return JSON.stringify({ sdp_flags: { gzip_sdp: options.gzipSdp } });
}

export function buildStreamerSignalHeaders(input: BuildStreamerSignalHeadersInput): Record<string, string> {
  return {
    "X-NRD-AUTH": input.token,
    ...STREAMER_DEFAULT_SIGNAL_HEADER_VALUES,
    // 覆盖必须写在默认值 spread 之后
    streamer_version: input.streamerVersion ?? STREAMER_CLIENT_VERSION,
    streamer_flag: buildStreamerFlagHeader({ gzipSdp: input.gzipSdp ?? true }),
  };
}
