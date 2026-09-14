import {
  buildDefaultStreamerDecoderCap,
  encodeBase64,
  encodeStreamerConnectOptions,
} from "./internal/connectOptionsCodec.js";
import {
  STREAMER_APP_CLIENT_VERSION,
  STREAMER_CAPTURE_TYPES,
  STREAMER_CHOOSE_RESOLUTION_TYPES,
  STREAMER_DEFAULT_BROWSER_LOCAL_RESOLUTION,
  STREAMER_DEFAULT_BROWSER_TYPE_VALUE,
  STREAMER_DEFAULT_BROWSER_VIRTUAL_DISPLAY_MODE,
  STREAMER_DEFAULT_FEATURE_FLAGS,
  STREAMER_FPS_VALUES,
  STREAMER_VIDEO_QUALITY_VALUES,
} from "./internal/connectOptionsSchema.js";
import {
  STREAMER_CLIENT_TYPES,
  STREAMER_CONTROL_CONNECT_TYPES,
  type StreamerScreenResolutionInput,
  type StreamerVirtualDisplayModeInput,
} from "./connectOptionsModel.js";

export interface BuildDefaultStreamerConnectOptionsBase64Input {
  deviceId: string;
  clientType?: number;
  controlConnectType?: number;
  fps?: number;
  videoQuality?: number;
  cursorCapture?: boolean;
  localResolution?: StreamerScreenResolutionInput | null;
  virtualDisplayModes?: readonly StreamerVirtualDisplayModeInput[];
  clientVersion?: string;
}

export function buildDefaultStreamerConnectOptionsBase64(input: BuildDefaultStreamerConnectOptionsBase64Input): string {
  return encodeBase64(
    encodeStreamerConnectOptions({
      deviceId: input.deviceId,
      captureType: STREAMER_CAPTURE_TYPES.CT_DESKTOP,
      typeValue: STREAMER_DEFAULT_BROWSER_TYPE_VALUE,
      captureParams: {
        fps: input.fps ?? STREAMER_FPS_VALUES.FPS_60,
        videoQuality: input.videoQuality ?? STREAMER_VIDEO_QUALITY_VALUES.VideoQuality_HD,
        cursorCapture: input.cursorCapture ?? true,
        chooseResolutionType: STREAMER_CHOOSE_RESOLUTION_TYPES.ChooseType_DEFAULT,
        localResolution: input.localResolution ?? STREAMER_DEFAULT_BROWSER_LOCAL_RESOLUTION,
      },
      decoderCapList: [buildDefaultStreamerDecoderCap()],
      virtualDisplayModes: input.virtualDisplayModes ?? [STREAMER_DEFAULT_BROWSER_VIRTUAL_DISPLAY_MODE],
      clientType: input.clientType ?? STREAMER_CLIENT_TYPES.Client_ANDROID,
      controlConnectType: input.controlConnectType ?? STREAMER_CONTROL_CONNECT_TYPES.ControlConnectType_Normal,
      featureFlags: STREAMER_DEFAULT_FEATURE_FLAGS,
      clientVersion: input.clientVersion ?? STREAMER_APP_CLIENT_VERSION,
    }),
  );
}
