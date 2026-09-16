import type { Variants } from "motion/react";
import * as m from "motion/react-m";

import { RemoteClipboardPanel, type RemoteClipboardPanelProps } from "./RemoteClipboardPanel.js";
import {
  RemoteConnectionQualityPanel,
  type RemoteConnectionQualityPanelProps,
} from "./RemoteConnectionQualityPanel.js";
import {
  RemoteControlDiagnosticsDrawer,
  type RemoteControlDiagnosticsDrawerProps,
} from "./RemoteControlDiagnosticsDrawer.js";
import { RemoteControlSettingsDrawer, type RemoteControlSettingsDrawerProps } from "./RemoteControlSettingsDrawer.js";
import { RemoteVideoOrientationPanel, type RemoteVideoOrientationPanelProps } from "./RemoteVideoOrientationPanel.js";
import { RemoteVideoSourcePanel, type RemoteVideoSourcePanelProps } from "./RemoteVideoSourcePanel.js";
import { Tabs } from "./ui/Tabs.js";

const sidePanelVariants = {
  initial: { opacity: 0, x: 14, scale: 0.992 },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    x: 10,
    scale: 0.995,
    transition: { duration: 0.13, ease: [0.4, 0, 1, 1] },
  },
} satisfies Variants;

interface RemoteControlSidePanelProps {
  tab: string;
  onTabChange: (value: string) => void;
  insights: {
    quality: RemoteConnectionQualityPanelProps;
    clipboard: RemoteClipboardPanelProps;
    videoSources: RemoteVideoSourcePanelProps;
  };
  settings: RemoteControlSettingsDrawerProps;
  diagnostics: RemoteControlDiagnosticsDrawerProps;
  orientation: RemoteVideoOrientationPanelProps;
}

export function RemoteControlSidePanel({
  tab,
  onTabChange,
  insights,
  settings,
  diagnostics,
  orientation,
}: RemoteControlSidePanelProps) {
  return (
    <m.aside
      className="control-side-panel"
      aria-label="会话面板"
      variants={sidePanelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <Tabs
        ariaLabel="会话面板"
        variant="pill"
        value={tab}
        onChange={onTabChange}
        items={[
          {
            value: "status",
            label: "状态",
            content: (
              <div className="control-side-panel-body">
                <RemoteConnectionQualityPanel {...insights.quality} />
                <RemoteVideoSourcePanel {...insights.videoSources} />
              </div>
            ),
          },
          {
            value: "clipboard",
            label: "剪贴板",
            content: (
              <div className="control-side-panel-body">
                <RemoteClipboardPanel {...insights.clipboard} />
              </div>
            ),
          },
          {
            value: "settings",
            label: "设置",
            content: (
              <div className="control-side-panel-body">
                <RemoteVideoOrientationPanel {...orientation} />
                <RemoteControlSettingsDrawer {...settings} />
                <RemoteControlDiagnosticsDrawer {...diagnostics} />
              </div>
            ),
          },
        ]}
      />
    </m.aside>
  );
}
