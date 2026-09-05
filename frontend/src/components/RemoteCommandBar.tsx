import {
  Eye,
  GripHorizontal,
  Keyboard,
  Send,
  LoaderCircle,
  Maximize2,
  MousePointerClick,
  PlugZap,
  Scan,
} from "lucide-react";
import { useState } from "react";

import type { BusyAction, NextAction, RemoteStageViewMode } from "../app/remoteControlTypes.js";
import type { RemoteShortcut } from "../remote/remoteShortcuts.js";
import { RemoteAudioControl, type RemoteAudioControlProps } from "./RemoteAudioControl.js";
import { RemoteShortcutMenu } from "./RemoteShortcutMenu.js";
import { useDraggableFloatingPanel } from "./useDraggableFloatingPanel.js";
import { useFullscreenIdleHide } from "./useFullscreenIdleHide.js";
import { Dialog } from "./ui/Dialog.js";

export interface RemoteCommandBarProps {
  busy: BusyAction;
  controlChannelState: RTCDataChannelState;
  inputControlActive: boolean;
  isFullscreen: boolean;
  nextAction: NextAction;
  onNextAction: (force?: boolean) => void;
  onRemoteShortcut: (shortcut: RemoteShortcut) => void;
  onStageViewModeChange: (mode: RemoteStageViewMode) => void;
  onToggleInputControl: () => void;
  onToggleFullscreen: () => void;
  canSendText: boolean;
  onSendText: (text: string) => boolean;
  remoteAudio: RemoteAudioControlProps;
  remoteShortcutPlatform: string;
  remoteStageViewMode: RemoteStageViewMode;
}

export function RemoteCommandBar({
  busy,
  controlChannelState,
  inputControlActive,
  isFullscreen,
  nextAction,
  onNextAction,
  onRemoteShortcut,
  onStageViewModeChange,
  onToggleInputControl,
  onToggleFullscreen,
  canSendText,
  onSendText,
  remoteAudio,
  remoteShortcutPlatform,
  remoteStageViewMode,
}: RemoteCommandBarProps) {
  const nextStageMode = remoteStageViewMode === "fit" ? "fill" : "fit";
  const [textOpen, setTextOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const { dragHandleProps, isDragging, panelRef, panelStyle } = useDraggableFloatingPanel<HTMLElement>();
  const idleHidden = useFullscreenIdleHide(isFullscreen, isDragging);
  const connected = controlChannelState === "open";

  return (
    <section
      ref={panelRef}
      className={`control-command-bar${idleHidden ? " control-command-bar--idle-hidden" : ""}`}
      style={panelStyle}
      aria-label="远控主流程"
    >
      <button className="command-drag-handle" type="button" aria-label="拖动工具栏" {...dragHandleProps}>
        <GripHorizontal size={17} />
      </button>
      <div className="command-action-group command-action-primary">
        {connected ? (
          <div className="control-mode-switch" role="group" aria-label="控制模式">
            <button
              type="button"
              className={!inputControlActive ? "is-active" : ""}
              aria-pressed={!inputControlActive}
              onClick={() => {
                if (inputControlActive) onToggleInputControl();
              }}
            >
              <Eye size={16} />
              仅查看
            </button>
            <button
              type="button"
              className={inputControlActive ? "is-active" : ""}
              aria-pressed={inputControlActive}
              onClick={() => {
                if (!inputControlActive) onToggleInputControl();
              }}
            >
              <MousePointerClick size={16} />
              控制中
            </button>
          </div>
        ) : (
          <button className="primary-action-button" onClick={() => onNextAction()} disabled={nextAction.disabled}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <PlugZap size={17} />}
            {nextAction.label}
          </button>
        )}
      </div>
      {!connected && nextAction.detail ? <p className="operation-note">{nextAction.detail}</p> : null}
      <div className="command-action-group command-action-tools" aria-label="远控工具栏">
        <RemoteAudioControl {...remoteAudio} />
        <button
          type="button"
          title="输入文字"
          aria-label="输入文字"
          disabled={!canSendText}
          onClick={() => setTextOpen(true)}
        >
          <Keyboard size={17} />
        </button>
        <button onClick={() => onStageViewModeChange(nextStageMode)}>
          <Scan size={17} />
          {remoteStageViewMode === "fit" ? "填充画面" : "适应画面"}
        </button>
        <button onClick={onToggleFullscreen}>
          <Maximize2 size={17} />
          {isFullscreen ? "退出全屏" : "全屏"}
        </button>
        <RemoteShortcutMenu
          disabled={!inputControlActive}
          platformKey={remoteShortcutPlatform}
          onRemoteShortcut={onRemoteShortcut}
        />
      </div>
      <Dialog open={textOpen} onClose={() => setTextOpen(false)} ariaLabel="输入文字">
        <label className="remote-text-input">
          <span>输入文字</span>
          <textarea rows={5} value={textDraft} onChange={(event) => setTextDraft(event.target.value)} />
        </label>
        <div className="remote-text-actions">
          <button type="button" onClick={() => setTextOpen(false)}>
            取消
          </button>
          <button
            type="button"
            disabled={!canSendText || !textDraft}
            onClick={() => {
              if (onSendText(textDraft)) {
                setTextDraft("");
                setTextOpen(false);
              }
            }}
          >
            <Send size={16} />
            发送
          </button>
        </div>
      </Dialog>
    </section>
  );
}
