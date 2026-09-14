import { RotateCcw } from "lucide-react";
import { AnimatePresence, type Variants } from "motion/react";
import * as m from "motion/react-m";

import type { BusyAction } from "../app/remoteControlTypes.js";

const reconnectBannerVariants = {
  initial: { opacity: 0, y: -10, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.99,
    transition: { duration: 0.12, ease: [0.4, 0, 1, 1] },
  },
} satisfies Variants;

export interface RemoteReconnectBannerProps {
  autoReconnectAttemptCount: number;
  autoReconnectStopped: boolean;
  busy: BusyAction;
  canReconnectRemote: boolean;
  onReconnectRemote: () => void;
  remoteRecoveryLabel: string;
}

export function RemoteReconnectBanner({
  autoReconnectAttemptCount,
  autoReconnectStopped,
  busy,
  canReconnectRemote,
  onReconnectRemote,
  remoteRecoveryLabel,
}: RemoteReconnectBannerProps) {
  const attemptSuffix = autoReconnectAttemptCount > 0 ? `（第 ${autoReconnectAttemptCount} 次）` : "";
  const progressLabel = autoReconnectStopped ? "已停止自动重连，可手动重连" : `正在自动重连${attemptSuffix}`;

  return (
    <AnimatePresence initial={false}>
      {remoteRecoveryLabel ? (
        <m.div
          key="remote-reconnect-banner"
          className="reconnect-banner"
          role="status"
          variants={reconnectBannerVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <span className="reconnect-banner-spinner" aria-hidden="true" />
          <span>
            {remoteRecoveryLabel} · {progressLabel}
          </span>
          <button onClick={onReconnectRemote} disabled={!canReconnectRemote || busy !== null}>
            <RotateCcw size={12} />
            立即重连
          </button>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
