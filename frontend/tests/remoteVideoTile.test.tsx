import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RemoteVideoTile } from "../src/components/RemoteVideoTile.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RemoteVideoTile", () => {
  it("records presented frames and video.play rejection details", async () => {
    const frameCallbacks = new Map<number, VideoFrameRequestCallback>();
    let nextFrameCallbackId = 1;
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      const id = nextFrameCallbackId++;
      frameCallbacks.set(id, callback);
      return id;
    });
    const cancelVideoFrameCallback = vi.fn((id: number) => frameCallbacks.delete(id));
    const requestDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "requestVideoFrameCallback");
    const cancelDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      Object.assign(new Error("playback was blocked"), { name: "NotAllowedError" }),
    );
    const onVideoSample = vi.fn();

    try {
      const view = render(
        <RemoteVideoTile
          videoId="video-track-1"
          index={0}
          stream={{} as MediaStream}
          visible
          orientation={{ rotation: 0, flip: "none" }}
          onVideoSample={onVideoSample}
        />,
      );
      await waitFor(() =>
        expect(onVideoSample).toHaveBeenCalledWith(
          "video-track-1",
          expect.objectContaining({
            event: "play_rejected",
            trackIdentifier: "video-track-1",
            errorName: "NotAllowedError",
            errorMessage: "playback was blocked",
          }),
        ),
      );

      const firstFrameCallback = frameCallbacks.values().next().value;
      expect(firstFrameCallback).toBeTypeOf("function");
      act(() => firstFrameCallback(16, {} as VideoFrameCallbackMetadata));
      fireEvent(view.getByLabelText("远控画面视频"), new Event("playing"));

      expect(onVideoSample).toHaveBeenLastCalledWith(
        "video-track-1",
        expect.objectContaining({
          event: "playing",
          presentedFrames: 1,
        }),
      );
      view.unmount();
      expect(cancelVideoFrameCallback).toHaveBeenCalled();
    } finally {
      if (requestDescriptor) {
        Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", requestDescriptor);
      } else {
        delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
      }
      if (cancelDescriptor) {
        Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", cancelDescriptor);
      } else {
        delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback;
      }
    }
  });

  it("exposes the display-only orientation attributes on the video tile", () => {
    const view = render(
      <RemoteVideoTile
        videoId="video-track-1"
        index={0}
        stream={{} as MediaStream}
        visible
        orientation={{ rotation: 90, flip: "vertical" }}
        onVideoSample={vi.fn()}
      />,
    );
    const tile = view.container.querySelector(".remote-video-tile");
    // 方向矫正只落在画面图层的 data 属性上，输入坐标和远端光标仍按未矫正的画面计算。
    expect(tile).toHaveAttribute("data-rotation", "90");
    expect(tile).toHaveAttribute("data-flip", "vertical");
  });
});
