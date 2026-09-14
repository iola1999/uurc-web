import { VERSION_NAME } from "../../constants.js";

export const STREAMER_ROOM_CONFIG_FIELDS = [
  "token",
  "signalServers",
  "timeout",
  "signalReconnectDelay",
  "reportToken",
  "reportUrl",
  "reportServerAddress",
] as const;

export const STREAMER_CONNECT_OPTIONS_FIELDS = [
  { tag: 1, name: "capture_type", repeated: false },
  { tag: 2, name: "type_value", repeated: false },
  { tag: 3, name: "capture_params", repeated: false },
  { tag: 4, name: "decoder_cap_list", repeated: true },
  { tag: 5, name: "force_virtual_display", repeated: false },
  { tag: 6, name: "virtual_display_modes", repeated: true },
  { tag: 7, name: "virtual_display_init_resolution", repeated: false },
  { tag: 8, name: "client_type", repeated: false },
  { tag: 9, name: "device_id", repeated: false },
  { tag: 10, name: "control_connect_type", repeated: false },
  { tag: 11, name: "feature_flag", repeated: false },
  { tag: 12, name: "client_version", repeated: false },
] as const;

export const STREAMER_CAPTURE_TYPES = {
  CT_UNKNOWN: 0,
  CT_DESKTOP: 1,
  CT_WINDOW: 2,
  CT_MUMU: 3,
  CT_HOOK: 4,
  CT_FILETRANSFER: 5,
  CT_SECOND_SCREEN: 6,
  CT_QUICKLAUNCH: 7,
  CT_TERMINAL: 8,
} as const;

// 与 HTTP 层 X-Param-VN 同源,避免两处版本值漂移
export const STREAMER_APP_CLIENT_VERSION = VERSION_NAME;

export const STREAMER_FEATURE_FLAG_FIELDS = [
  { tag: 1, name: "ff_capture_setting" },
  { tag: 2, name: "ff_simple_action" },
  { tag: 3, name: "ff_system_metrics" },
  { tag: 4, name: "ff_private_screen" },
  { tag: 5, name: "ff_update_acquire" },
  { tag: 6, name: "ff_file_transfer_ftp" },
  { tag: 7, name: "ff_file_transfer_ftp2" },
  { tag: 8, name: "ff_clipboard" },
  { tag: 9, name: "ff_qos_stat" },
  { tag: 10, name: "ff_mumu_control" },
  { tag: 11, name: "ff_virtual_mouse_device" },
] as const;

export const STREAMER_DEFAULT_FEATURE_FLAGS = {
  ff_capture_setting: 2,
  ff_simple_action: 1,
  ff_system_metrics: 2,
  ff_private_screen: 2,
  ff_update_acquire: 0,
  ff_file_transfer_ftp: 2,
  ff_file_transfer_ftp2: 2,
  ff_clipboard: 3,
  ff_qos_stat: 0,
  ff_mumu_control: 0,
  ff_virtual_mouse_device: 0,
} as const;

export const STREAMER_DEFAULT_BROWSER_VIRTUAL_DISPLAY_MODE = { width: 1920, height: 1080, fps: 60 } as const;
export const STREAMER_DEFAULT_BROWSER_LOCAL_RESOLUTION = { width: 1920, height: 1080 } as const;
export const STREAMER_DEFAULT_BROWSER_TYPE_VALUE = -1;

export const STREAMER_CAPTURE_PARAM_FIELDS = [
  { tag: 1, name: "fps", defaultValue: "FPS_UNKNOWN" },
  { tag: 2, name: "video_quality", defaultValue: "VideoQuality_UNKNOWN" },
  { tag: 3, name: "cursor_capture", defaultValue: false },
  { tag: 4, name: "choose_resolution_type", defaultValue: "ChooseType_UNKNOWN" },
  { tag: 5, name: "local_resolution", defaultValue: null },
  { tag: 6, name: "choose_resolution", defaultValue: null },
  { tag: 7, name: "chroma_format", defaultValue: "ChromaFormat_UNKNOWN" },
  { tag: 8, name: "max_custom_bitrate", defaultValue: 0 },
  { tag: 9, name: "enable_hdr", defaultValue: false },
  { tag: 10, name: "auto_frame_quality", defaultValue: "VideoQuality_UNKNOWN" },
  { tag: 11, name: "fpsCount", defaultValue: 0 },
] as const;

export const STREAMER_SCREEN_RESOLUTION_FIELDS = [
  { tag: 1, name: "width", defaultValue: 0 },
  { tag: 2, name: "height", defaultValue: 0 },
] as const;

export const STREAMER_FPS_VALUES = { FPS_UNKNOWN: 0, FPS_30: 1, FPS_60: 2, FPS_90: 3, FPS_144: 4 } as const;

export const STREAMER_VIDEO_QUALITY_VALUES = {
  VideoQuality_UNKNOWN: 0,
  VideoQuality_Fast: 1,
  VideoQuality_General: 2,
  VideoQuality_HD: 3,
  VideoQuality_Bluray: 4,
  VideoQuality_Auto: 5,
  VideoQuality_Custom: 6,
} as const;

export const STREAMER_CHOOSE_RESOLUTION_TYPES = {
  ChooseType_UNKNOWN: 0,
  ChooseType_DEFAULT: 1,
  ChooseType_FOLLOW_LOCAL: 2,
  ChooseType_FOLLOW_REMOTE: 3,
  ChooseType_RESOLUTION: 4,
} as const;

export const STREAMER_CHROMA_FORMATS = {
  ChromaFormat_UNKNOWN: 0,
  ChromaFormat_420: 1,
  ChromaFormat_422: 2,
  ChromaFormat_444: 3,
  ChromaFormat_400: 4,
} as const;

export const STREAMER_VIDEO_CODECS = { Unknown: 0, H264: 1, H265: 2, VP8: 3, VP9: 4, AV1: 5 } as const;

export const STREAMER_DECODER_CAP_FIELDS = [
  { tag: 1, name: "fps", defaultValue: 0 },
  { tag: 2, name: "codec_type", defaultValue: "CodecType_UNKNOWN" },
  { tag: 3, name: "resolution_width", defaultValue: 0 },
  { tag: 4, name: "resolution_height", defaultValue: 0 },
  { tag: 5, name: "chroma_format", defaultValue: "ChromaFormat_UNKNOWN" },
] as const;

export const STREAMER_DECODER_CODEC_TYPES = { CodecType_UNKNOWN: 0, CodecType_H264: 1, CodecType_H265: 2 } as const;

export const STREAMER_DECODER_CHROMA_FORMATS = {
  ChromaFormat_UNKNOWN: 0,
  ChromaFormat_420: 1,
  ChromaFormat_422: 2,
  ChromaFormat_444: 3,
  ChromaFormat_400: 4,
} as const;

export const STREAMER_CAPTURE_PARAM_DEFAULTS = {
  fps: "FPS_UNKNOWN",
  videoQuality: "VideoQuality_UNKNOWN",
  cursorCapture: false,
  chooseResolutionType: "ChooseType_UNKNOWN",
  localResolution: null,
  chooseResolution: null,
  chromaFormat: "ChromaFormat_UNKNOWN",
  maxCustomBitrate: 0,
  enableHdr: false,
  autoFrameQuality: "VideoQuality_UNKNOWN",
  fpsCount: 0,
} as const;
