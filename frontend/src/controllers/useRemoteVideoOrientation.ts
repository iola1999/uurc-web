import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_REMOTE_VIDEO_ORIENTATION,
  isDefaultRemoteVideoOrientation,
  normalizeRemoteVideoOrientation,
  type RemoteVideoOrientation,
} from "../remote/remoteVideoOrientation.js";

export const REMOTE_VIDEO_ORIENTATION_STORAGE_KEY = "uurc.videoOrientationByDevice";

type RemoteVideoOrientationMap = Record<string, RemoteVideoOrientation>;

// 画面方向是单台被控端的属性：同一台设备记住上次的矫正结果，换设备时不会把上一台的旋转带过去。
export function useRemoteVideoOrientation(deviceId: string) {
  const [orientationByDevice, setOrientationByDevice] =
    useState<RemoteVideoOrientationMap>(readRemoteVideoOrientationMap);

  useEffect(() => {
    writeRemoteVideoOrientationMap(orientationByDevice);
  }, [orientationByDevice]);

  const orientation = (deviceId ? orientationByDevice[deviceId] : undefined) ?? DEFAULT_REMOTE_VIDEO_ORIENTATION;
  const setOrientation = useCallback(
    (next: RemoteVideoOrientation) => {
      if (!deviceId) return;
      setOrientationByDevice((current) => {
        const updated = { ...current };
        // 恢复默认时删掉记录，避免本地存储里堆积无意义的条目。
        if (isDefaultRemoteVideoOrientation(next)) delete updated[deviceId];
        else updated[deviceId] = next;
        return updated;
      });
    },
    [deviceId],
  );

  return { orientation, setOrientation };
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
      const orientation = normalizeRemoteVideoOrientation(value);
      if (!isDefaultRemoteVideoOrientation(orientation)) map[key] = orientation;
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
