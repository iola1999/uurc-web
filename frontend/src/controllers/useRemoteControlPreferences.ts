import { useEffect, useState } from "react";

import type {
  ConnectionRouteMode,
  RemoteStageViewMode,
  SdpTransportMode,
  SignalChannelMode,
} from "../app/remoteControlTypes.js";
import { detectDirectSignalExtension, type DirectSignalExtensionInfo } from "../direct/extensionBridge.js";

const SIGNAL_CHANNEL_MODES: SignalChannelMode[] = ["auto", "gateway", "direct"];

export function useRemoteControlPreferences(signalServerCount: number) {
  const [autoReconnectEnabled, setAutoReconnectEnabled] = useState(true);
  const [sdpTransportMode, setSdpTransportMode] = useState<SdpTransportMode>("gzip");
  const [connectionRouteMode, setConnectionRouteMode] = useState<ConnectionRouteMode>("auto");
  const [signalChannelMode, setSignalChannelMode] = useState<SignalChannelMode>(readSignalChannelPreference);
  const [directSignalExtensionInfo, setDirectSignalExtensionInfo] = useState<DirectSignalExtensionInfo | null>(null);
  const [autoConnect, setAutoConnect] = useState<boolean>(readAutoConnectPreference);
  const [remoteStageViewMode, setRemoteStageViewMode] = useState<RemoteStageViewMode>("fit");
  const [signalServerIndex, setSignalServerIndex] = useState(0);
  const [browserWebRtcUnavailableReason] = useState(detectBrowserWebRtcUnavailableReason);

  useEffect(() => {
    if (signalServerCount > 0 && signalServerIndex >= signalServerCount) {
      setSignalServerIndex(0);
    }
  }, [signalServerCount, signalServerIndex]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("uurc.autoConnect", autoConnect ? "true" : "false");
    } catch {
      // Ignore persistence failures in private or sandboxed browser contexts.
    }
  }, [autoConnect]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("uurc.signalChannelMode", signalChannelMode);
    } catch {
      // Ignore persistence failures in private or sandboxed browser contexts.
    }
  }, [signalChannelMode]);

  // 切换信令通道偏好时重新探测扩展(负结果只有 30s 缓存,装上扩展后无需刷新页面)
  useEffect(() => {
    let cancelled = false;
    detectDirectSignalExtension()
      .then((info) => {
        if (!cancelled) setDirectSignalExtensionInfo(info);
      })
      .catch(() => {
        if (!cancelled) setDirectSignalExtensionInfo({ available: false, reason: "扩展探测失败" });
      });
    return () => {
      cancelled = true;
    };
  }, [signalChannelMode]);

  return {
    autoReconnectEnabled,
    setAutoReconnectEnabled,
    sdpTransportMode,
    setSdpTransportMode,
    connectionRouteMode,
    setConnectionRouteMode,
    signalChannelMode,
    setSignalChannelMode,
    directSignalExtensionInfo,
    autoConnect,
    setAutoConnect,
    remoteStageViewMode,
    setRemoteStageViewMode,
    signalServerIndex,
    setSignalServerIndex,
    browserWebRtcUnavailableReason,
  };
}

function readAutoConnectPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem("uurc.autoConnect") !== "false";
  } catch {
    return true;
  }
}

function readSignalChannelPreference(): SignalChannelMode {
  try {
    const value = globalThis.localStorage?.getItem("uurc.signalChannelMode");
    return SIGNAL_CHANNEL_MODES.includes(value as SignalChannelMode) ? (value as SignalChannelMode) : "auto";
  } catch {
    return "auto";
  }
}

function detectBrowserWebRtcUnavailableReason(): string {
  if (typeof RTCPeerConnection !== "function") {
    return "当前浏览器未启用 WebRTC，无法建立远控画面。请允许 WebRTC 后重试。";
  }

  try {
    const peer = new RTCPeerConnection({ iceServers: [] });
    peer.close();
    return "";
  } catch {
    return "当前浏览器无法创建 WebRTC 连接。请检查浏览器隐私设置或扩展拦截后重试。";
  }
}
