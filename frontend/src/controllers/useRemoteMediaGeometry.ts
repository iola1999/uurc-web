import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import type { RemoteStageViewMode } from "../app/remoteControlTypes.js";
import { computeRemoteMediaGeometry, type RemoteMediaGeometry } from "../remote/remoteMediaGeometry.js";
import type { RemoteVideoRotation } from "../remote/remoteVideoOrientation.js";

export function useRemoteMediaGeometry(options: {
  stageRef: RefObject<HTMLDivElement | null>;
  viewMode: RemoteStageViewMode;
  primaryVideoId: string;
  rotation: RemoteVideoRotation;
}) {
  const { stageRef, viewMode, primaryVideoId, rotation } = options;
  const geometryRef = useRef<RemoteMediaGeometry | undefined>(undefined);
  const geometryChangeListenersRef = useRef(new Set<() => void>());

  const notifyGeometryChange = useCallback(() => {
    for (const listener of geometryChangeListenersRef.current) listener();
  }, []);

  const subscribeGeometryChange = useCallback((listener: () => void): (() => void) => {
    geometryChangeListenersRef.current.add(listener);
    listener();
    return () => geometryChangeListenersRef.current.delete(listener);
  }, []);

  const refreshGeometry = useCallback((): RemoteMediaGeometry | undefined => {
    const stage = stageRef.current;
    if (!stage) {
      geometryRef.current = undefined;
      notifyGeometryChange();
      return undefined;
    }

    const stageRect = stage.getBoundingClientRect();
    const video = stage.querySelector<HTMLVideoElement>('video[data-active="true"]') ?? stage.querySelector("video");
    const elementWidth = video?.videoWidth || Math.round(stageRect.width);
    const elementHeight = video?.videoHeight || Math.round(stageRect.height);
    // 旋转 90°/270° 之后画面在屏幕上的长宽是对调的，几何按对调后的尺寸算才等于屏幕上真实的内容框。
    const quarterTurn = rotation === 90 || rotation === 270;
    const mediaWidth = quarterTurn ? elementHeight : elementWidth;
    const mediaHeight = quarterTurn ? elementWidth : elementHeight;
    const geometry = computeRemoteMediaGeometry({
      containerRect: {
        left: stageRect.left,
        top: stageRect.top,
        width: stageRect.width,
        height: stageRect.height,
      },
      mediaWidth,
      mediaHeight,
      objectFit: viewMode === "fill" ? "cover" : "contain",
    });
    geometryRef.current = geometry;
    notifyGeometryChange();
    return geometry;
  }, [notifyGeometryChange, rotation, stageRef, viewMode]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let activeVideo: HTMLVideoElement | null = null;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(refreshGeometry) : undefined;
    const updateObservedVideo = () => {
      const nextVideo =
        stage.querySelector<HTMLVideoElement>('video[data-active="true"]') ?? stage.querySelector("video");
      if (nextVideo !== activeVideo) {
        if (activeVideo) {
          activeVideo.removeEventListener("loadedmetadata", refreshGeometry);
          activeVideo.removeEventListener("resize", refreshGeometry);
          activeVideo.removeEventListener("playing", refreshGeometry);
          resizeObserver?.unobserve(activeVideo);
        }
        activeVideo = nextVideo;
        if (activeVideo) {
          activeVideo.addEventListener("loadedmetadata", refreshGeometry);
          activeVideo.addEventListener("resize", refreshGeometry);
          activeVideo.addEventListener("playing", refreshGeometry);
          resizeObserver?.observe(activeVideo);
        }
      }
      refreshGeometry();
    };

    resizeObserver?.observe(stage);
    const mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(updateObservedVideo) : undefined;
    mutationObserver?.observe(stage, {
      attributeFilter: ["data-active"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", refreshGeometry, { passive: true });
    document.addEventListener("scroll", refreshGeometry, { capture: true, passive: true });
    updateObservedVideo();
    const frame = requestGeometryFrame(updateObservedVideo);

    return () => {
      cancelGeometryFrame(frame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refreshGeometry);
      document.removeEventListener("scroll", refreshGeometry, true);
      if (activeVideo) {
        activeVideo.removeEventListener("loadedmetadata", refreshGeometry);
        activeVideo.removeEventListener("resize", refreshGeometry);
        activeVideo.removeEventListener("playing", refreshGeometry);
      }
      geometryRef.current = undefined;
      notifyGeometryChange();
    };
  }, [notifyGeometryChange, primaryVideoId, refreshGeometry, stageRef]);

  return { geometryRef, refreshGeometry, subscribeGeometryChange };
}

function requestGeometryFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") return window.requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 0);
}

function cancelGeometryFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}
