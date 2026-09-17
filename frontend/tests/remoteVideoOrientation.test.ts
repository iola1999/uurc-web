import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING,
  formatRemoteVideoOrientationDiagnostics,
  isDefaultRemoteVideoOrientationSetting,
  normalizeRemoteVideoOrientationSetting,
  parseRemoteVideoOrientationExtensionId,
  resolveRemoteVideoOrientation,
} from "../src/remote/remoteVideoOrientation.js";

describe("remoteVideoOrientation", () => {
  it("keeps a valid rotation and flip", () => {
    expect(normalizeRemoteVideoOrientationSetting({ rotation: 90, flip: "horizontal" })).toEqual({
      rotation: 90,
      flip: "horizontal",
    });
    expect(normalizeRemoteVideoOrientationSetting({ rotation: 270, flip: "vertical" })).toEqual({
      rotation: 270,
      flip: "vertical",
    });
  });

  it("falls back to the default setting for unknown values", () => {
    expect(normalizeRemoteVideoOrientationSetting({ rotation: 45, flip: "diagonal" })).toEqual(
      DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING,
    );
    expect(normalizeRemoteVideoOrientationSetting(undefined)).toEqual(DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING);
    expect(normalizeRemoteVideoOrientationSetting("90")).toEqual(DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING);
    expect(normalizeRemoteVideoOrientationSetting(null)).toEqual(DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING);
  });

  it("recognizes the default setting", () => {
    expect(isDefaultRemoteVideoOrientationSetting({ rotation: "auto", flip: "none" })).toBe(true);
    expect(isDefaultRemoteVideoOrientationSetting({ rotation: "auto", flip: "vertical" })).toBe(false);
    expect(isDefaultRemoteVideoOrientationSetting({ rotation: 0, flip: "none" })).toBe(false);
  });

  it("turns the picture by 180° when the browser applied a reported 90° or 270°", () => {
    for (const reportedRotation of [90, 270] as const) {
      expect(resolveRemoteVideoOrientation({ rotation: "auto", flip: "none" }, { reportedRotation })).toEqual({
        rotation: 180,
        flip: "none",
      });
    }
    for (const reportedRotation of [0, 180] as const) {
      expect(resolveRemoteVideoOrientation({ rotation: "auto", flip: "none" }, { reportedRotation })).toEqual({
        rotation: 0,
        flip: "none",
      });
    }
  });

  it("reads the quarter turn off the element size when the probe has no value", () => {
    const swapped = {
      elementSize: { width: 1440, height: 1280 },
      decodedSize: { width: 1280, height: 1440 },
    };
    expect(resolveRemoteVideoOrientation({ rotation: "auto", flip: "horizontal" }, swapped)).toEqual({
      rotation: 180,
      flip: "horizontal",
    });
    expect(
      resolveRemoteVideoOrientation(
        { rotation: "auto", flip: "none" },
        { elementSize: { width: 1920, height: 1080 }, decodedSize: { width: 1920, height: 1080 } },
      ),
    ).toEqual({ rotation: 0, flip: "none" });
    // 正方形画面两种角度看起来一样，按没转处理。
    expect(
      resolveRemoteVideoOrientation(
        { rotation: "auto", flip: "none" },
        { elementSize: { width: 1080, height: 1080 }, decodedSize: { width: 1080, height: 1080 } },
      ),
    ).toEqual({ rotation: 0, flip: "none" });
    expect(resolveRemoteVideoOrientation({ rotation: "auto", flip: "none" }, {})).toEqual({
      rotation: 0,
      flip: "none",
    });
  });

  it("keeps a chosen angle whatever the remote reports", () => {
    expect(resolveRemoteVideoOrientation({ rotation: 180, flip: "none" }, { reportedRotation: 90 })).toEqual({
      rotation: 180,
      flip: "none",
    });
    expect(
      resolveRemoteVideoOrientation(
        { rotation: 0, flip: "none" },
        { elementSize: { width: 1440, height: 1280 }, decodedSize: { width: 1280, height: 1440 } },
      ),
    ).toEqual({ rotation: 0, flip: "none" });
  });

  it("reads the orientation extmap id out of the remote SDP", () => {
    const sdp = ["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=extmap:3 urn:3gpp:video-orientation", "a=recvonly"].join("\r\n");
    expect(parseRemoteVideoOrientationExtensionId(sdp)).toBe(3);
    expect(parseRemoteVideoOrientationExtensionId("a=extmap:2 urn:ietf:params:rtp-hdrext:toffset")).toBeUndefined();
    expect(parseRemoteVideoOrientationExtensionId(undefined)).toBeUndefined();
  });

  it("puts the reported angle, the sizes and the applied angle on one diagnostics line", () => {
    expect(
      formatRemoteVideoOrientationDiagnostics({
        setting: { rotation: "auto", flip: "none" },
        resolved: { rotation: 180, flip: "none" },
        signals: {
          reportedRotation: 90,
          elementSize: { width: 1440, height: 1280 },
          decodedSize: { width: 1280, height: 1440 },
        },
        probeAvailable: true,
        extension: { known: true, extensionId: 3 },
      }),
    ).toBe("远端上报=90° · 已协商 id=3 · 元素=1440x1280 · 解码=1280x1440 · 设置=跟随 · 画面=180°/不翻转");
  });

  it("tells apart a missing report, a missing extension and a browser without the probe", () => {
    const base = {
      setting: { rotation: 90, flip: "vertical" },
      resolved: { rotation: 90, flip: "vertical" },
      signals: {},
    } as const;
    expect(formatRemoteVideoOrientationDiagnostics({ ...base, probeAvailable: true, extension: { known: true } })).toBe(
      "远端上报=未读到 · 未协商方向扩展 · 设置=90° · 画面=90°/上下翻转",
    );
    expect(
      formatRemoteVideoOrientationDiagnostics({ ...base, probeAvailable: false, extension: { known: false } }),
    ).toBe("远端上报=不可读 · 设置=90° · 画面=90°/上下翻转");
  });
});
