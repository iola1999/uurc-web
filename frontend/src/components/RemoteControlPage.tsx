import { MonitorX, TerminalSquare } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useState, type RefObject } from "react";

import { RemoteCommandBar, type RemoteCommandBarProps } from "./RemoteCommandBar.js";
import type { RemoteClipboardPanelProps } from "./RemoteClipboardPanel.js";
import type { RemoteConnectionQualityPanelProps } from "./RemoteConnectionQualityPanel.js";
import type { RemoteControlDiagnosticsDrawerProps } from "./RemoteControlDiagnosticsDrawer.js";
import type { RemoteControlSettingsDrawerProps } from "./RemoteControlSettingsDrawer.js";
import { RemoteControlSidePanel } from "./RemoteControlSidePanel.js";
import { RemoteControlStage, type RemoteControlStageProps } from "./RemoteControlStage.js";
import { RemoteControlTopbar, type RemoteControlTopbarProps } from "./RemoteControlTopbar.js";
import { RemoteControlWarnings, type RemoteControlWarningsProps } from "./RemoteControlWarnings.js";
import { RemoteOccupiedDialog } from "./RemoteOccupiedDialog.js";
import { RemoteReconnectBanner, type RemoteReconnectBannerProps } from "./RemoteReconnectBanner.js";
import type { RemoteVideoSourcePanelProps } from "./RemoteVideoSourcePanel.js";

export interface RemoteControlPageProps {
  shell: {
    deviceNotFound: boolean;
    error: string;
    isFullscreen: boolean;
    onReturnToDevices: () => void;
    remoteStageFrameRef: RefObject<HTMLDivElement | null>;
  };
  topbar: RemoteControlTopbarProps;
  commandBar: RemoteCommandBarProps;
  reconnect: RemoteReconnectBannerProps;
  stage: RemoteControlStageProps;
  warnings: RemoteControlWarningsProps;
  insights: {
    quality: RemoteConnectionQualityPanelProps;
    clipboard: RemoteClipboardPanelProps;
    videoSources: RemoteVideoSourcePanelProps;
  };
  settings: RemoteControlSettingsDrawerProps;
  diagnostics: RemoteControlDiagnosticsDrawerProps;
}

export function RemoteControlPage(props: RemoteControlPageProps) {
  const { shell } = props;
  const [panelOpen, setPanelOpen] = useState(true);
  const [sidePanelTab, setSidePanelTab] = useState("status");
  const [occupiedDialogOpen, setOccupiedDialogOpen] = useState(false);
  const [occupancyAcknowledged, setOccupancyAcknowledged] = useState(false);

  const { occupiedBySelfClient, selectedDeviceOccupied } = props.warnings;
  // 若用户已在“设置”里显式选择了“接管控制”，无需再弹一次确认对话框。
  const showOccupiedGate =
    selectedDeviceOccupied && !occupiedBySelfClient && !occupancyAcknowledged && !props.settings.forceJoin;

  function handlePrimaryAction() {
    if (showOccupiedGate) {
      setOccupiedDialogOpen(true);
      return;
    }
    props.commandBar.onNextAction();
  }

  function resolveOccupiedDialog(force: boolean) {
    setOccupiedDialogOpen(false);
    setOccupancyAcknowledged(true);
    if (force) props.settings.onForceJoinChange(true);
    props.commandBar.onNextAction(force);
  }

  if (shell.deviceNotFound) {
    return (
      <main className="control-shell">
        <header className="control-topbar">
          <button className="secondary-button" onClick={shell.onReturnToDevices}>
            返回设备列表
          </button>
          <div>
            <h1>设备不存在</h1>
          </div>
          <div className="topbar-actions" />
        </header>
        <section className="device-missing-card">
          <MonitorX size={40} />
          <strong>找不到这台设备</strong>
          <p>该设备可能已被移除、不属于当前账号，或链接已失效。请返回设备列表重新选择。</p>
          <button className="primary-action-button" onClick={shell.onReturnToDevices}>
            返回设备列表
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="control-shell">
      <RemoteControlTopbar
        {...props.topbar}
        screenPicker={props.insights.videoSources}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((open) => !open)}
      />

      {shell.error ? (
        <section className="error-strip" role="alert" aria-live="assertive">
          <TerminalSquare size={18} />
          <span>{shell.error}</span>
        </section>
      ) : null}

      <RemoteControlWarnings {...props.warnings} />

      <section className="control-stage-layout">
        <div
          className={`control-stage-frame${shell.isFullscreen ? " control-stage-frame--fullscreen" : ""}`}
          ref={shell.remoteStageFrameRef}
        >
          <RemoteControlStage {...props.stage} />
          <RemoteReconnectBanner {...props.reconnect} />
          <RemoteCommandBar {...props.commandBar} onNextAction={handlePrimaryAction} />
          {shell.isFullscreen ? (
            <div className="fullscreen-hint">工具栏可拖到任意位置 · 无操作 2 秒后自动隐藏 · Esc 退出全屏</div>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {panelOpen ? (
            <RemoteControlSidePanel
              key="remote-control-side-panel"
              tab={sidePanelTab}
              onTabChange={setSidePanelTab}
              insights={props.insights}
              settings={props.settings}
              diagnostics={props.diagnostics}
            />
          ) : null}
        </AnimatePresence>
      </section>

      <RemoteOccupiedDialog
        open={occupiedDialogOpen}
        deviceLabel={props.topbar.selectedDevice?.alias ?? props.topbar.selectedTargetLabel}
        participants={props.settings.selectedParticipants}
        onCancel={() => setOccupiedDialogOpen(false)}
        onJoinNormal={() => resolveOccupiedDialog(false)}
        onTakeover={() => resolveOccupiedDialog(true)}
      />
    </main>
  );
}
