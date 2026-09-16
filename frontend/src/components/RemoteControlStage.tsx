import {
  Ban,
  Check,
  CircleHelp,
  Crosshair,
  Hand,
  LoaderCircle,
  Monitor,
  MousePointer2,
  Move,
  MoveDiagonal,
  MoveDiagonal2,
  MoveHorizontal,
  MoveVertical,
  TextCursor,
} from "lucide-react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent, RefObject, WheelEvent } from "react";

import type { UuDevice } from "@uurc/shared/devices";

import type { RemoteStageViewMode, RemoteVideoStream } from "../app/remoteControlTypes.js";
import type {
  BrowserRemoteSessionState,
  BrowserRemoteVideoElementSample,
} from "../remote/browserRemoteSessionTypes.js";
import type { RemoteVideoOrientation } from "../remote/remoteVideoOrientation.js";
import { getConnectingStageSteps } from "../remote/remoteSessionUiModel.js";
import { RemoteVideoTile } from "./RemoteVideoTile.js";

export interface RemoteControlStageProps {
  browserRemoteState: BrowserRemoteSessionState;
  browserStageLabel: string;
  hasRemoteVideo: boolean;
  inputControlActive: boolean;
  inputControlLabel: string;
  onRemoteStageKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onRemoteStageKeyUp: (event: KeyboardEvent<HTMLDivElement>) => void;
  onRemoteStageBlur: () => void;
  onRemoteStagePaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onRemoteStagePointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onRemoteStagePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onRemoteStagePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onRemoteStagePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onRemoteStageWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onRemoteVideoSample: (videoId: string, sample: BrowserRemoteVideoElementSample) => void;
  primaryRemoteVideoActive: boolean;
  primaryRemoteVideoId: string;
  remoteStageRef: RefObject<HTMLDivElement | null>;
  remoteStageViewMode: RemoteStageViewMode;
  remoteVideoCount: number;
  remoteVideoOrientation: RemoteVideoOrientation;
  remoteVideoStreams: RemoteVideoStream[];
  selectedDevice: UuDevice | null;
  stageStatusLabel: string;
  videoFlowLabel: string;
}

export function RemoteControlStage({
  browserRemoteState,
  browserStageLabel,
  hasRemoteVideo,
  inputControlActive,
  inputControlLabel,
  onRemoteStageKeyDown,
  onRemoteStageKeyUp,
  onRemoteStageBlur,
  onRemoteStagePaste,
  onRemoteStagePointerCancel,
  onRemoteStagePointerDown,
  onRemoteStagePointerMove,
  onRemoteStagePointerUp,
  onRemoteStageWheel,
  onRemoteVideoSample,
  primaryRemoteVideoActive,
  primaryRemoteVideoId,
  remoteStageRef,
  remoteStageViewMode,
  remoteVideoCount,
  remoteVideoOrientation,
  remoteVideoStreams,
  selectedDevice,
  stageStatusLabel,
  videoFlowLabel,
}: RemoteControlStageProps) {
  return (
    <div
      ref={remoteStageRef}
      className={`remote-stage control-remote-stage remote-stage-${remoteStageViewMode} ${inputControlActive ? "remote-stage-interactive" : ""}`}
      role="application"
      aria-label="远控画面"
      tabIndex={0}
      onPointerDown={onRemoteStagePointerDown}
      onPointerMove={onRemoteStagePointerMove}
      onPointerUp={onRemoteStagePointerUp}
      onPointerCancel={onRemoteStagePointerCancel}
      onWheel={onRemoteStageWheel}
      onContextMenu={(event) => {
        // 已解锁输入时，拦截浏览器右键菜单：否则原生菜单会吞掉 pointerup，
        // 导致“抬起右键”发不出去、被控端右键卡死、之后左键都被当右键。
        if (inputControlActive) event.preventDefault();
      }}
      onKeyDown={onRemoteStageKeyDown}
      onKeyUp={onRemoteStageKeyUp}
      onBlur={onRemoteStageBlur}
      onPaste={onRemoteStagePaste}
    >
      {hasRemoteVideo ? (
        <>
          <div className="remote-video-grid">
            {remoteVideoStreams.map((video, index) => (
              <RemoteVideoTile
                key={video.id}
                videoId={video.id}
                index={index}
                visible={video.id === primaryRemoteVideoId}
                stream={video.stream}
                orientation={remoteVideoOrientation}
                onVideoSample={onRemoteVideoSample}
              />
            ))}
          </div>
          {!primaryRemoteVideoActive ? (
            <div className="stage-center stage-center--overlay">
              <Monitor size={34} />
              <strong>该画面暂无内容</strong>
              <span>这一路当前没有画面输出，可在右侧「画面源」切换到其他画面。</span>
            </div>
          ) : null}
          <div className="stage-badge">
            {browserStageLabel} · {remoteVideoCount} 路视频 · {videoFlowLabel} · 输入 {inputControlLabel}
          </div>
          <RemoteCursorOverlay />
        </>
      ) : stageStatusLabel === "连接中…" ? (
        <>
          <div className="stage-grid" />
          <div className="stage-center">
            <span className="stage-spinner" aria-hidden="true" />
            <strong>正在连接 {selectedDevice?.alias ?? "设备"}…</strong>
            <ConnectingSteps browserRemoteState={browserRemoteState} hasRemoteVideo={hasRemoteVideo} />
          </div>
        </>
      ) : (
        <>
          <div className="stage-grid" />
          <div className="stage-center">
            <Monitor size={34} />
            <strong>{selectedDevice?.alias ?? "未选择设备"}</strong>
            <span>{stageStatusLabel}</span>
          </div>
        </>
      )}
    </div>
  );
}

function ConnectingSteps({
  browserRemoteState,
  hasRemoteVideo,
}: Pick<RemoteControlStageProps, "browserRemoteState" | "hasRemoteVideo">) {
  const steps = getConnectingStageSteps(browserRemoteState.stage, hasRemoteVideo);
  return (
    <div className="connecting-steps">
      {steps.map((step, index) => (
        <span key={step.key} className="connecting-steps-item">
          {index > 0 ? <span className="connecting-steps-arrow">→</span> : null}
          <span className={`connecting-steps-label connecting-steps-${step.status}`}>
            {step.status === "done" ? <Check size={12} /> : null}
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function RemoteCursorOverlay() {
  return (
    <div className="remote-cursor-overlay" data-remote-cursor-overlay data-visible="false" aria-hidden="true">
      <MousePointer2 data-remote-cursor-glyph="default" />
      <Hand data-remote-cursor-glyph="pointer" />
      <TextCursor data-remote-cursor-glyph="text" />
      <Crosshair data-remote-cursor-glyph="crosshair" />
      <LoaderCircle data-remote-cursor-glyph="wait" />
      <span className="remote-cursor-progress-glyph" data-remote-cursor-glyph="progress">
        <MousePointer2 />
        <LoaderCircle />
      </span>
      <Move data-remote-cursor-glyph="move" />
      <MoveDiagonal2 data-remote-cursor-glyph="nwse-resize" />
      <MoveDiagonal data-remote-cursor-glyph="nesw-resize" />
      <MoveHorizontal data-remote-cursor-glyph="ew-resize" />
      <MoveVertical data-remote-cursor-glyph="ns-resize" />
      <Ban data-remote-cursor-glyph="not-allowed" />
      <CircleHelp data-remote-cursor-glyph="help" />
    </div>
  );
}
