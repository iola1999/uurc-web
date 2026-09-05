import { useEffect, useRef, useState } from "react";

import type { BusyAction } from "../app/remoteControlTypes.js";
import type { BrowserRemoteSessionState } from "../remote/browserRemoteSessionTypes.js";

interface RemoteRecoveryOptions {
  autoReconnectEnabled: boolean;
  browserRemoteState: BrowserRemoteSessionState;
  busy: BusyAction;
  controlChannelState: RTCDataChannelState;
  roomJoinedForSelectedDevice: boolean;
  signalGatewayMatchesRoom: boolean;
  onReconnect(attemptCount: number): Promise<void>;
}

export function useRemoteRecoveryController(options: RemoteRecoveryOptions) {
  const [attemptCount, setAttemptCount] = useState(0);
  const [decodeStalledStreak, setDecodeStalledStreak] = useState(0);
  const [status, setStatus] = useState("");
  const onReconnectRef = useRef(options.onReconnect);
  onReconnectRef.current = options.onReconnect;
  const flowStatus = options.browserRemoteState.videoFlow?.status;
  const flowUpdatedAtMs = options.browserRemoteState.videoFlow?.updatedAtMs;

  useEffect(() => {
    setDecodeStalledStreak((streak) =>
      flowStatus === "decode_stalled" || flowStatus === "presentation_stalled" ? streak + 1 : 0,
    );
  }, [flowStatus, flowUpdatedAtMs]);

  const decodeStalledPersisted =
    (flowStatus === "decode_stalled" || flowStatus === "presentation_stalled") && decodeStalledStreak >= 2;
  const canRecover =
    Boolean(options.browserRemoteState.failureReason) ||
    (attemptCount > 0 && options.browserRemoteState.stage === "idle") ||
    (options.browserRemoteState.stage === "connected" &&
      (!options.signalGatewayMatchesRoom ||
        options.controlChannelState === "closed" ||
        flowStatus === "transport_stalled" ||
        decodeStalledPersisted));

  const healthy =
    options.browserRemoteState.stage === "connected" &&
    options.controlChannelState === "open" &&
    options.signalGatewayMatchesRoom &&
    flowStatus === "receiving";
  useEffect(() => {
    if (!options.roomJoinedForSelectedDevice) {
      setAttemptCount(0);
      setStatus("");
      return;
    }
    if (!healthy) return;
    const timer = window.setTimeout(() => {
      setAttemptCount(0);
      setStatus("");
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [healthy, options.roomJoinedForSelectedDevice]);

  useEffect(() => {
    if (!canRecover) {
      setStatus("");
      return;
    }
    if (!options.autoReconnectEnabled || options.busy !== null || !options.roomJoinedForSelectedDevice) {
      return;
    }

    const delayMs = Math.min(5000, 900 * 2 ** Math.min(attemptCount, 3));
    setStatus(`自动重连将在 ${Math.ceil(delayMs / 1000)} 秒后尝试`);
    const timer = window.setTimeout(() => {
      setAttemptCount((count) => count + 1);
      void onReconnectRef.current(attemptCount).catch(() => setStatus("重连失败，稍后重试"));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    attemptCount,
    canRecover,
    options.autoReconnectEnabled,
    options.busy,
    options.roomJoinedForSelectedDevice,
    options.signalGatewayMatchesRoom,
  ]);

  return {
    autoReconnectAttemptCount: attemptCount,
    autoReconnectStatus: status,
    browserConnectionRecoverable: canRecover,
    decodeStalledStreak,
  };
}
