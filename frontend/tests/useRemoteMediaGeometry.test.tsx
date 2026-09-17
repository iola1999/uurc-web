// @vitest-environment jsdom
import { useEffect, useRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRemoteMediaGeometry } from "../src/controllers/useRemoteMediaGeometry.js";
import type { RemoteVideoRotation } from "../src/remote/remoteVideoOrientation.js";

describe("useRemoteMediaGeometry", () => {
  it("publishes geometry refreshes without using React state and supports unsubscribe", async () => {
    let currentRect = new DOMRect(10, 20, 800, 450);
    let controller: ReturnType<typeof useRemoteMediaGeometry> | undefined;
    render(
      <GeometryHarness
        getRect={() => currentRect}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );
    await waitFor(() => expect(controller?.geometryRef.current).toBeDefined());

    const listener = vi.fn();
    const unsubscribe = controller!.subscribeGeometryChange(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    currentRect = new DOMRect(40, 60, 800, 450);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(controller!.geometryRef.current?.containerRect).toMatchObject({ left: 40, top: 60 });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    act(() => controller!.refreshGeometry());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // 旋转 90°/270° 后画面在屏幕上的长宽是对调的，内容框要按对调后的尺寸算，否则点击位置会落在别处。
  it("swaps the media size for a quarter turn", async () => {
    const rect = new DOMRect(0, 0, 800, 450);
    const geometryByRotation = new Map<RemoteVideoRotation, ReturnType<typeof useRemoteMediaGeometry>>();
    for (const rotation of [0, 90, 180, 270] as const) {
      let controller: ReturnType<typeof useRemoteMediaGeometry> | undefined;
      render(
        <GeometryHarness
          getRect={() => rect}
          rotation={rotation}
          videoSize={{ width: 1280, height: 1440 }}
          onController={(nextController) => {
            controller = nextController;
          }}
        />,
      );
      await waitFor(() => expect(controller?.geometryRef.current).toBeDefined());
      geometryByRotation.set(rotation, controller!);
    }

    for (const rotation of [0, 180] as const) {
      expect(geometryByRotation.get(rotation)!.geometryRef.current).toMatchObject({
        mediaWidth: 1280,
        mediaHeight: 1440,
      });
    }
    for (const rotation of [90, 270] as const) {
      const geometry = geometryByRotation.get(rotation)!.geometryRef.current!;
      expect(geometry).toMatchObject({ mediaWidth: 1440, mediaHeight: 1280 });
      // contain 之后内容框的高度铺满舞台，宽度按对调后的比例，正是屏幕上真实看到的那块。
      expect(Math.round(geometry.displayRect.height)).toBe(450);
      expect(Math.round(geometry.displayRect.width)).toBe(506);
    }
  });
});

function GeometryHarness({
  getRect,
  onController,
  rotation = 0,
  videoSize,
}: {
  getRect(): DOMRect;
  onController(controller: ReturnType<typeof useRemoteMediaGeometry>): void;
  rotation?: RemoteVideoRotation;
  videoSize?: { width: number; height: number };
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const controller = useRemoteMediaGeometry({ stageRef, viewMode: "fit", primaryVideoId: "video-1", rotation });
  useEffect(() => onController(controller), [controller, onController]);
  return (
    <div
      ref={(element) => {
        stageRef.current = element;
        if (element) element.getBoundingClientRect = getRect;
      }}
    >
      <video
        data-active="true"
        ref={(element) => {
          if (!element || !videoSize) return;
          // jsdom 不解码视频，videoWidth/videoHeight 恒为 0，这里按浏览器转过之后的尺寸给出。
          Object.defineProperty(element, "videoWidth", { value: videoSize.width, configurable: true });
          Object.defineProperty(element, "videoHeight", { value: videoSize.height, configurable: true });
        }}
      />
    </div>
  );
}
