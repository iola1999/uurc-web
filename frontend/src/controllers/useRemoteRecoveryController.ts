import { useEffect, useRef, useState } from "react";

import type { BusyAction } from "../app/remoteControlTypes.js";
import type { BrowserRemoteSessionState } from "../remote/browserRemoteSessionTypes.js";

// 连续自动重连的次数上限，达到后停止自动重试，交给手动重连。
const MAX_AUTO_RECONNECT_ATTEMPTS = 10;
// 最近这么多次触发落在 BURST_WINDOW_MS 内视为链路在反复掉线，后续重试进入退避。
const BURST_ATTEMPT_COUNT = 3;
const BURST_WINDOW_MS = 20_000;
const BURST_BASE_DELAY_MS = 10_000;
const BURST_MAX_DELAY_MS = 60_000;
const NORMAL_MAX_DELAY_MS = 5000;
// 连接恢复健康并保持这么久才清零计数，避免短暂恢复就把上限洗掉。
const HEALTHY_RESET_MS = 10_000;

function isReconnectBurst(times: number[]): boolean {
  if (times.length < BURST_ATTEMPT_COUNT) return false;
  return times[times.length - 1] - times[times.length - BURST_ATTEMPT_COUNT] <= BURST_WINDOW_MS;
}

function reconnectDelayMs(attemptCount: number, burst: boolean): number {
  if (!burst) return Math.min(NORMAL_MAX_DELAY_MS, 900 * 2 ** Math.min(attemptCount, 3));
  // 触发间隔过密说明不是在恢复而是在抖动，后续按 20s、40s、60s 递增，封顶 60s。
  const burstStep = Math.max(0, attemptCount - (BURST_ATTEMPT_COUNT - 1));
  return Math.min(BURST_MAX_DELAY_MS, BURST_BASE_DELAY_MS * 2 ** Math.min(burstStep, 3));
}

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
  const [burst, setBurst] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [decodeStalledStreak, setDecodeStalledStreak] = useState(0);
  const [status, setStatus] = useState("");
  const attemptTimesRef = useRef<number[]>([]);
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
      attemptTimesRef.current = [];
      setAttemptCount(0);
      setBurst(false);
      setStatus("");
      setStopped(false);
      return;
    }
    if (!healthy) return;
    const timer = window.setTimeout(() => {
      attemptTimesRef.current = [];
      setAttemptCount(0);
      setBurst(false);
      setStatus("");
      setStopped(false);
    }, HEALTHY_RESET_MS);
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
    if (stopped) {
      setStatus(`已连续自动重连 ${MAX_AUTO_RECONNECT_ATTEMPTS} 次未恢复，停止自动重试，可手动重连`);
      return;
    }

    // 检测到突发后保持退避直到连接恢复健康，否则一次退避等待就会让判定掉回正常间隔来回振荡。
    const nextBurst = burst || isReconnectBurst(attemptTimesRef.current);
    if (nextBurst && !burst) setBurst(true);
    const delayMs = reconnectDelayMs(attemptCount, nextBurst);
    setStatus(`自动重连将在 ${Math.ceil(delayMs / 1000)} 秒后尝试`);
    const timer = window.setTimeout(() => {
      attemptTimesRef.current = [...attemptTimesRef.current, Date.now()].slice(-MAX_AUTO_RECONNECT_ATTEMPTS);
      const nextCount = attemptCount + 1;
      setAttemptCount(nextCount);
      if (nextCount >= MAX_AUTO_RECONNECT_ATTEMPTS) setStopped(true);
      void onReconnectRef.current(attemptCount).catch(() => setStatus("重连失败，稍后重试"));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    attemptCount,
    burst,
    canRecover,
    options.autoReconnectEnabled,
    options.busy,
    options.roomJoinedForSelectedDevice,
    options.signalGatewayMatchesRoom,
    stopped,
  ]);

  return {
    autoReconnectAttemptCount: attemptCount,
    autoReconnectStatus: status,
    autoReconnectStopped: stopped,
    browserConnectionRecoverable: canRecover,
    decodeStalledStreak,
  };
}
