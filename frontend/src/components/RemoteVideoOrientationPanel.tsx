import type { RemoteVideoFlip, RemoteVideoOrientation, RemoteVideoRotation } from "../remote/remoteVideoOrientation.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";

export interface RemoteVideoOrientationPanelProps {
  orientation: RemoteVideoOrientation;
  onOrientationChange: (orientation: RemoteVideoOrientation) => void;
}

const ROTATION_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "0°" },
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
];

const FLIP_OPTIONS: { value: RemoteVideoFlip; label: string }[] = [
  { value: "none", label: "不翻转" },
  { value: "horizontal", label: "左右" },
  { value: "vertical", label: "上下" },
];

// 部分被控端回传的画面方向与真实坐标不一致：这里做纯显示层矫正，输入换算和远端光标不受影响。
export function RemoteVideoOrientationPanel({ orientation, onOrientationChange }: RemoteVideoOrientationPanelProps) {
  return (
    <section className="video-orientation-panel" aria-label="画面方向">
      <div className="video-source-caption">画面方向</div>
      <div className="control-field">
        <span className="control-field-label">旋转</span>
        <SegmentedControl
          name="remoteVideoRotation"
          ariaLabel="画面旋转"
          columns={4}
          value={String(orientation.rotation)}
          onChange={(value) => onOrientationChange({ ...orientation, rotation: Number(value) as RemoteVideoRotation })}
          options={ROTATION_OPTIONS}
        />
      </div>
      <div className="control-field">
        <span className="control-field-label">翻转</span>
        <SegmentedControl
          name="remoteVideoFlip"
          ariaLabel="画面翻转"
          columns={3}
          value={orientation.flip}
          onChange={(value) => onOrientationChange({ ...orientation, flip: value })}
          options={FLIP_OPTIONS}
        />
      </div>
      <p className="field-hint">只改变本机看到的方向，鼠标和触控坐标保持原样。</p>
    </section>
  );
}
