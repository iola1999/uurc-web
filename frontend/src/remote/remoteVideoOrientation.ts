// 画面方向矫正：部分被控端回传的视频帧方向与远端真实坐标不一致（画面看起来旋转/镜像，鼠标却是对的）。
// 这里只描述「本机显示层」的旋转与翻转，输入坐标换算仍然走原始画面，因此矫正不会移动鼠标位置。
export type RemoteVideoRotation = 0 | 90 | 180 | 270;
export type RemoteVideoFlip = "none" | "horizontal" | "vertical";

export interface RemoteVideoOrientation {
  rotation: RemoteVideoRotation;
  flip: RemoteVideoFlip;
}

export const DEFAULT_REMOTE_VIDEO_ORIENTATION: RemoteVideoOrientation = { rotation: 0, flip: "none" };

const ROTATIONS: RemoteVideoRotation[] = [0, 90, 180, 270];
const FLIPS: RemoteVideoFlip[] = ["none", "horizontal", "vertical"];

export function normalizeRemoteVideoOrientation(value: unknown): RemoteVideoOrientation {
  if (!value || typeof value !== "object") return { ...DEFAULT_REMOTE_VIDEO_ORIENTATION };
  const candidate = value as { rotation?: unknown; flip?: unknown };
  const rotation = ROTATIONS.includes(candidate.rotation as RemoteVideoRotation)
    ? (candidate.rotation as RemoteVideoRotation)
    : DEFAULT_REMOTE_VIDEO_ORIENTATION.rotation;
  const flip = FLIPS.includes(candidate.flip as RemoteVideoFlip)
    ? (candidate.flip as RemoteVideoFlip)
    : DEFAULT_REMOTE_VIDEO_ORIENTATION.flip;
  return { rotation, flip };
}

export function isDefaultRemoteVideoOrientation(orientation: RemoteVideoOrientation): boolean {
  return orientation.rotation === 0 && orientation.flip === "none";
}
