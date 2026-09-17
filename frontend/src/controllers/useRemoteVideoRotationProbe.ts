import { useEffect, useState } from "react";

import {
  isRemoteVideoRotationProbeSupported,
  startRemoteVideoRotationProbe,
} from "../remote/remoteVideoRotationProbe.js";
import type { RemoteVideoRotation } from "../remote/remoteVideoOrientation.js";

const probeSupported = isRemoteVideoRotationProbeSupported();

// 探测远端逐帧上报的画面方向。探针跑在轨道副本上，画面渲染不受影响；读不到时保持 undefined。
export function useRemoteVideoRotationProbe(track: MediaStreamTrack | undefined) {
  const [reportedRotation, setReportedRotation] = useState<RemoteVideoRotation | undefined>(undefined);

  useEffect(() => {
    setReportedRotation(undefined);
    if (!track || !probeSupported) return;
    const probe = startRemoteVideoRotationProbe({
      track,
      onRotation: (rotation) => {
        // 每帧都回调，只有角度变化时才触发渲染。
        setReportedRotation((current) => (current === rotation ? current : rotation));
      },
    });
    return () => probe?.stop();
  }, [track]);

  return { reportedRotation, available: probeSupported };
}
