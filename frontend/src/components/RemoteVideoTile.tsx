import { useEffect, useRef } from "react";

import type { BrowserRemoteVideoElementSample } from "../remote/browserRemoteSessionTypes.js";
import type { RemoteVideoOrientation } from "../remote/remoteVideoOrientation.js";

export function RemoteVideoTile({
  videoId,
  index,
  stream,
  visible,
  orientation,
  onVideoSample,
}: {
  videoId: string;
  index: number;
  stream: MediaStream;
  visible: boolean;
  orientation: RemoteVideoOrientation;
  onVideoSample: (videoId: string, sample: BrowserRemoteVideoElementSample) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const presentedFramesRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      presentedFramesRef.current = undefined;
    }

    let active = true;
    const emitSample = (event: string, playbackError?: unknown) => {
      if (!active) return;
      onVideoSample(videoId, readVideoElementSample(video, videoId, event, presentedFramesRef.current, playbackError));
    };
    try {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch((error: unknown) => emitSample("play_rejected", error));
      }
    } catch (error) {
      emitSample("play_rejected", error);
    }

    const eventNames = ["playing", "waiting", "stalled", "suspend", "pause", "ended", "error"] as const;
    const handlers = eventNames.map((eventName) => {
      const handler = () => emitSample(eventName);
      video.addEventListener(eventName, handler);
      return { eventName, handler };
    });
    let frameCallbackId: number | undefined;
    const requestNextFrame = () => {
      if (typeof video.requestVideoFrameCallback !== "function") return;
      frameCallbackId = video.requestVideoFrameCallback(() => {
        if (!active) return;
        presentedFramesRef.current = (presentedFramesRef.current ?? 0) + 1;
        requestNextFrame();
      });
    };
    requestNextFrame();
    emitSample("attached");
    const timer = window.setInterval(() => emitSample("sample"), visible ? 1000 : 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (frameCallbackId !== undefined && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCallbackId);
      }
      for (const { eventName, handler } of handlers) {
        video.removeEventListener(eventName, handler);
      }
    };
  }, [onVideoSample, stream, videoId, visible]);

  return (
    <div
      className={visible ? "remote-video-tile" : "remote-video-tile remote-video-tile-hidden"}
      aria-hidden={visible ? undefined : true}
      // 解析后的方向：自动摆正的角度和手动选的角度都已经合并进来。
      data-rotation={String(orientation.rotation)}
      data-flip={orientation.flip}
    >
      <video
        ref={videoRef}
        className="remote-video"
        aria-label={visible ? "远控画面视频" : undefined}
        autoPlay
        playsInline
        muted
        tabIndex={visible ? undefined : -1}
        data-track-index={index + 1}
        data-active={visible ? "true" : undefined}
      />
    </div>
  );
}

function readVideoElementSample(
  video: HTMLVideoElement,
  trackIdentifier: string,
  event: string,
  presentedFrames: number | undefined,
  playbackError?: unknown,
): BrowserRemoteVideoElementSample {
  const quality = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
  const error = playbackError instanceof Error ? playbackError : undefined;
  return {
    event,
    trackIdentifier,
    currentTimeMs: Math.round(video.currentTime * 1000),
    totalVideoFrames: quality?.totalVideoFrames,
    presentedFrames,
    droppedVideoFrames: quality?.droppedVideoFrames,
    readyState: video.readyState,
    paused: video.paused,
    ended: video.ended,
    width: video.videoWidth,
    height: video.videoHeight,
    errorCode: video.error?.code,
    errorMessage: video.error?.message || error?.message,
    errorName: error?.name,
  };
}
