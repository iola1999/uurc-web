import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  REMOTE_VIDEO_ORIENTATION_STORAGE_KEY,
  useRemoteVideoOrientation,
} from "../src/controllers/useRemoteVideoOrientation.js";

afterEach(() => window.localStorage.clear());

function readStoredMap(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY) ?? "{}") as Record<
    string,
    unknown
  >;
}

describe("useRemoteVideoOrientation", () => {
  it("defaults to no correction and remembers it per device", () => {
    const { result, rerender } = renderHook(({ deviceId }) => useRemoteVideoOrientation(deviceId), {
      initialProps: { deviceId: "device-a" },
    });
    expect(result.current.orientation).toEqual({ rotation: 0, flip: "none" });

    act(() => result.current.setOrientation({ rotation: 90, flip: "none" }));
    expect(result.current.orientation).toEqual({ rotation: 90, flip: "none" });
    expect(readStoredMap()).toEqual({ "device-a": { rotation: 90, flip: "none" } });

    // 换设备后读取的是另一台设备的设置，不能沿用上一台的旋转。
    rerender({ deviceId: "device-b" });
    expect(result.current.orientation).toEqual({ rotation: 0, flip: "none" });
    rerender({ deviceId: "device-a" });
    expect(result.current.orientation).toEqual({ rotation: 90, flip: "none" });
  });

  it("restores a stored correction and drops it when reset to default", () => {
    window.localStorage.setItem(
      REMOTE_VIDEO_ORIENTATION_STORAGE_KEY,
      JSON.stringify({ "device-a": { rotation: 180, flip: "vertical" } }),
    );

    const { result } = renderHook(() => useRemoteVideoOrientation("device-a"));
    expect(result.current.orientation).toEqual({ rotation: 180, flip: "vertical" });

    act(() => result.current.setOrientation({ rotation: 0, flip: "none" }));
    expect(result.current.orientation).toEqual({ rotation: 0, flip: "none" });
    expect(window.localStorage.getItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY)).toBeNull();
  });

  it("ignores corrupt storage and devices without an id", () => {
    window.localStorage.setItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useRemoteVideoOrientation(""));
    expect(result.current.orientation).toEqual({ rotation: 0, flip: "none" });
    act(() => result.current.setOrientation({ rotation: 270, flip: "none" }));
    expect(result.current.orientation).toEqual({ rotation: 0, flip: "none" });
  });
});
