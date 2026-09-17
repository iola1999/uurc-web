import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING,
  isDefaultRemoteVideoOrientationSetting,
  normalizeRemoteVideoOrientationSetting,
  type RemoteVideoOrientationSetting,
} from "../remote/remoteVideoOrientation.js";

export const REMOTE_VIDEO_ORIENTATION_STORAGE_KEY = "uurc.videoOrientationByDevice";

type RemoteVideoOrientationMap = Record<string, RemoteVideoOrientationSetting>;

// 画面方向是单台被控端的属性：同一台设备记住上次选的设置，换设备时不会把上一台的旋转带过去。
// 默认是自动，只有选了具体角度或翻转才会落盘，所以升级前存下的角度含义不变。
export function useRemoteVideoOrientation(deviceId: string) {
  const [orientationByDevice, setOrientationByDevice] =
    useState<RemoteVideoOrientationMap>(readRemoteVideoOrientationMap);

  useEffect(() => {
    writeRemoteVideoOrientationMap(orientationByDevice);
  }, [orientationByDevice]);

  const setting = (deviceId ? orientationByDevice[deviceId] : undefined) ?? DEFAULT_REMOTE_VIDEO_ORIENTATION_SETTING;
  const setSetting = useCallback(
    (next: RemoteVideoOrientationSetting) => {
      if (!deviceId) return;
      setOrientationByDevice((current) => {
        const updated = { ...current };
        // 恢复默认时删掉记录，避免本地存储里堆积无意义的条目。
        if (isDefaultRemoteVideoOrientationSetting(next)) delete updated[deviceId];
        else updated[deviceId] = next;
        return updated;
      });
    },
    [deviceId],
  );

  return { setting, setSetting };
}

export function readRemoteVideoOrientationMap(): RemoteVideoOrientationMap {
  try {
    const raw = globalThis.localStorage?.getItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: RemoteVideoOrientationMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key) continue;
      const setting = normalizeRemoteVideoOrientationSetting(value);
      if (!isDefaultRemoteVideoOrientationSetting(setting)) map[key] = setting;
    }
    return map;
  } catch {
    // 隐私模式或脏数据：放弃持久化，本次会话仍可正常使用。
    return {};
  }
}

export function writeRemoteVideoOrientationMap(map: RemoteVideoOrientationMap): void {
  try {
    if (Object.keys(map).length === 0) globalThis.localStorage?.removeItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY);
    else globalThis.localStorage?.setItem(REMOTE_VIDEO_ORIENTATION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 隐私模式或沙箱环境下放弃持久化，保持内存状态可用。
  }
}
