import { describe, expect, it } from "vitest";

import { VERSION_NAME } from "../src/constants.js";
import { buildDefaultStreamerConnectOptionsBase64 } from "../src/streamer/connectOptions.js";
import { STREAMER_CLIENT_TYPES, STREAMER_CONTROL_CONNECT_TYPES } from "../src/streamer/connectOptionsModel.js";
import {
  buildDefaultStreamerDecoderCap,
  encodeStreamerConnectOptions,
  encodeStreamerDecoderCap,
} from "../src/streamer/internal/connectOptionsCodec.js";
import {
  STREAMER_CONNECT_OPTIONS_FIELDS,
  STREAMER_CAPTURE_TYPES,
  STREAMER_APP_CLIENT_VERSION,
  STREAMER_CAPTURE_PARAM_FIELDS,
  STREAMER_CAPTURE_PARAM_DEFAULTS,
  STREAMER_CHOOSE_RESOLUTION_TYPES,
  STREAMER_CHROMA_FORMATS,
  STREAMER_DECODER_CAP_FIELDS,
  STREAMER_DECODER_CHROMA_FORMATS,
  STREAMER_DECODER_CODEC_TYPES,
  STREAMER_DEFAULT_FEATURE_FLAGS,
  STREAMER_FEATURE_FLAG_FIELDS,
  STREAMER_FPS_VALUES,
  STREAMER_SCREEN_RESOLUTION_FIELDS,
  STREAMER_VIDEO_QUALITY_VALUES,
  STREAMER_ROOM_CONFIG_FIELDS,
} from "../src/streamer/internal/connectOptionsSchema.js";

describe("streamer connect options", () => {
  it("captures the ConnectOptions wire field tags recovered from the App", () => {
    expect(STREAMER_CONNECT_OPTIONS_FIELDS).toEqual([
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
    ]);
  });

  it("captures confirmed ConnectOptions enums", () => {
    expect(STREAMER_CAPTURE_TYPES).toEqual({
      CT_UNKNOWN: 0,
      CT_DESKTOP: 1,
      CT_WINDOW: 2,
      CT_MUMU: 3,
      CT_HOOK: 4,
      CT_FILETRANSFER: 5,
      CT_SECOND_SCREEN: 6,
      CT_QUICKLAUNCH: 7,
      CT_TERMINAL: 8,
    });
    expect(STREAMER_CONTROL_CONNECT_TYPES).toEqual({
      ControlConnectType_UNKNOWN: 0,
      ControlConnectType_Normal: 1,
      ControlConnectType_Assistance: 2,
    });
    expect(STREAMER_CLIENT_TYPES).toEqual({
      Client_UNSPECIFIED: 0,
      Client_IOS: 1,
      Client_ANDROID: 2,
      Client_WINDOWS: 3,
      Client_MAC: 4,
    });
    expect(STREAMER_APP_CLIENT_VERSION).toBe(VERSION_NAME);
    expect(STREAMER_DECODER_CAP_FIELDS).toEqual([
      { tag: 1, name: "fps", defaultValue: 0 },
      { tag: 2, name: "codec_type", defaultValue: "CodecType_UNKNOWN" },
      { tag: 3, name: "resolution_width", defaultValue: 0 },
      { tag: 4, name: "resolution_height", defaultValue: 0 },
      { tag: 5, name: "chroma_format", defaultValue: "ChromaFormat_UNKNOWN" },
    ]);
    expect(STREAMER_DECODER_CODEC_TYPES).toEqual({
      CodecType_UNKNOWN: 0,
      CodecType_H264: 1,
      CodecType_H265: 2,
    });
    expect(STREAMER_DECODER_CHROMA_FORMATS).toEqual({
      ChromaFormat_UNKNOWN: 0,
      ChromaFormat_420: 1,
      ChromaFormat_422: 2,
      ChromaFormat_444: 3,
      ChromaFormat_400: 4,
    });
    expect(STREAMER_FEATURE_FLAG_FIELDS.map((field) => field.name)).toEqual([
      "ff_capture_setting",
      "ff_simple_action",
      "ff_system_metrics",
      "ff_private_screen",
      "ff_update_acquire",
      "ff_file_transfer_ftp",
      "ff_file_transfer_ftp2",
      "ff_clipboard",
      "ff_qos_stat",
      "ff_mumu_control",
      "ff_virtual_mouse_device",
    ]);
    expect(STREAMER_DEFAULT_FEATURE_FLAGS).toEqual({
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
    });
  });

  it("captures CaptureParams fields, enums, and static defaults", () => {
    expect(STREAMER_CAPTURE_PARAM_FIELDS).toEqual([
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
    ]);
    expect(STREAMER_SCREEN_RESOLUTION_FIELDS).toEqual([
      { tag: 1, name: "width", defaultValue: 0 },
      { tag: 2, name: "height", defaultValue: 0 },
    ]);
    expect(STREAMER_FPS_VALUES).toEqual({
      FPS_UNKNOWN: 0,
      FPS_30: 1,
      FPS_60: 2,
      FPS_90: 3,
      FPS_144: 4,
    });
    expect(STREAMER_VIDEO_QUALITY_VALUES).toEqual({
      VideoQuality_UNKNOWN: 0,
      VideoQuality_Fast: 1,
      VideoQuality_General: 2,
      VideoQuality_HD: 3,
      VideoQuality_Bluray: 4,
      VideoQuality_Auto: 5,
      VideoQuality_Custom: 6,
    });
    expect(STREAMER_CHOOSE_RESOLUTION_TYPES).toEqual({
      ChooseType_UNKNOWN: 0,
      ChooseType_DEFAULT: 1,
      ChooseType_FOLLOW_LOCAL: 2,
      ChooseType_FOLLOW_REMOTE: 3,
      ChooseType_RESOLUTION: 4,
    });
    expect(STREAMER_CHROMA_FORMATS).toEqual({
      ChromaFormat_UNKNOWN: 0,
      ChromaFormat_420: 1,
      ChromaFormat_422: 2,
      ChromaFormat_444: 3,
      ChromaFormat_400: 4,
    });
    expect(STREAMER_CAPTURE_PARAM_DEFAULTS).toEqual({
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
    });
  });

  it("encodes a default App-shaped ConnectOptions payload for browser control", () => {
    const decoderCap = buildDefaultStreamerDecoderCap();
    expect(Array.from(decoderCap)).toEqual([0x08, 0x3c, 0x10, 0x01, 0x18, 0x80, 0x1e, 0x20, 0xf0, 0x10, 0x28, 0x01]);
    expect(
      Array.from(
        encodeStreamerDecoderCap({
          fps: 60,
          codecType: STREAMER_DECODER_CODEC_TYPES.CodecType_H264,
          width: 3840,
          height: 2160,
          chromaFormat: STREAMER_DECODER_CHROMA_FORMATS.ChromaFormat_420,
        }),
      ),
    ).toEqual(Array.from(decoderCap));

    const bytes = encodeStreamerConnectOptions({
      deviceId: "web-device-1",
      captureType: STREAMER_CAPTURE_TYPES.CT_DESKTOP,
      typeValue: -1,
      captureParams: {
        fps: STREAMER_FPS_VALUES.FPS_60,
        videoQuality: STREAMER_VIDEO_QUALITY_VALUES.VideoQuality_HD,
        cursorCapture: true,
        chooseResolutionType: STREAMER_CHOOSE_RESOLUTION_TYPES.ChooseType_DEFAULT,
        localResolution: { width: 1920, height: 1080 },
      },
      decoderCapList: [decoderCap],
      virtualDisplayModes: [{ width: 1920, height: 1080, fps: 60 }],
      clientType: STREAMER_CLIENT_TYPES.Client_ANDROID,
      controlConnectType: STREAMER_CONTROL_CONNECT_TYPES.ControlConnectType_Normal,
      featureFlags: STREAMER_DEFAULT_FEATURE_FLAGS,
      clientVersion: STREAMER_APP_CLIENT_VERSION,
    });

    expect(Array.from(bytes)).toEqual([
      0x08, 0x01, 0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x1a, 0x10, 0x08, 0x02, 0x10, 0x03,
      0x18, 0x01, 0x20, 0x01, 0x2a, 0x06, 0x08, 0x80, 0x0f, 0x10, 0xb8, 0x08, 0x22, 0x0c, 0x08, 0x3c, 0x10, 0x01, 0x18,
      0x80, 0x1e, 0x20, 0xf0, 0x10, 0x28, 0x01, 0x32, 0x08, 0x08, 0x80, 0x0f, 0x10, 0xb8, 0x08, 0x18, 0x3c, 0x40, 0x02,
      0x4a, 0x0c, 0x77, 0x65, 0x62, 0x2d, 0x64, 0x65, 0x76, 0x69, 0x63, 0x65, 0x2d, 0x31, 0x50, 0x01, 0x5a, 0x0e, 0x08,
      0x02, 0x10, 0x01, 0x18, 0x02, 0x20, 0x02, 0x30, 0x02, 0x38, 0x02, 0x40, 0x03, 0x62, 0x06, 0x34, 0x2e, 0x33, 0x39,
      0x2e, 0x31,
    ]);
    expect(buildDefaultStreamerConnectOptionsBase64({ deviceId: "web-device-1" })).toBe(
      "CAEQ////////////ARoQCAIQAxgBIAEqBgiADxC4CCIMCDwQARiAHiDwECgBMggIgA8QuAgYPEACSgx3ZWItZGV2aWNlLTFQAVoOCAIQARgCIAIwAjgCQANiBjQuMzkuMQ==",
    );
    expect(buildDefaultStreamerConnectOptionsBase64({ deviceId: "web-device-1", cursorCapture: false })).toBe(
      "CAEQ////////////ARoOCAIQAyABKgYIgA8QuAgiDAg8EAEYgB4g8BAoATIICIAPELgIGDxAAkoMd2ViLWRldmljZS0xUAFaDggCEAEYAiACMAI4AkADYgY0LjM5LjE=",
    );
    expect(
      buildDefaultStreamerConnectOptionsBase64({
        deviceId: "web-device-1",
        controlConnectType: STREAMER_CONTROL_CONNECT_TYPES.ControlConnectType_Assistance,
      }),
    ).toBe(
      "CAEQ////////////ARoQCAIQAxgBIAEqBgiADxC4CCIMCDwQARiAHiDwECgBMggIgA8QuAgYPEACSgx3ZWItZGV2aWNlLTFQAloOCAIQARgCIAIwAjgCQANiBjQuMzkuMQ==",
    );
    expect(
      buildDefaultStreamerConnectOptionsBase64({
        deviceId: "web-device-1",
        clientType: STREAMER_CLIENT_TYPES.Client_MAC,
      }),
    ).toBe(
      "CAEQ////////////ARoQCAIQAxgBIAEqBgiADxC4CCIMCDwQARiAHiDwECgBMggIgA8QuAgYPEAESgx3ZWItZGV2aWNlLTFQAVoOCAIQARgCIAIwAjgCQANiBjQuMzkuMQ==",
    );
  });

  it("omits the ConnectOptions type_value tag by default for normal desktop control", () => {
    const bytes = encodeStreamerConnectOptions({
      deviceId: "web-device-1",
      captureType: STREAMER_CAPTURE_TYPES.CT_DESKTOP,
    });

    expect(Array.from(bytes).slice(0, 4)).toEqual([0x08, 0x01, 0x40, 0x02]);
  });

  it("keeps room config fields explicit", () => {
    expect(STREAMER_ROOM_CONFIG_FIELDS).toEqual([
      "token",
      "signalServers",
      "timeout",
      "signalReconnectDelay",
      "reportToken",
      "reportUrl",
      "reportServerAddress",
    ]);
  });
});
