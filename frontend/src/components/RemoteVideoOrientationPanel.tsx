import type {
  RemoteVideoFlip,
  RemoteVideoOrientationSetting,
  RemoteVideoRotation,
  RemoteVideoRotationSetting,
} from "../remote/remoteVideoOrientation.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";

export interface RemoteVideoOrientationPanelProps {
  setting: RemoteVideoOrientationSetting;
  onSettingChange: (setting: RemoteVideoOrientationSetting) => void;
}

const ROTATION_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "跟随" },
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

// 跟随按被控端上报的方向摆正；选具体角度表示在浏览器渲染出来的画面上再转多少，用于上报缺失或者不对的被控端。
export function RemoteVideoOrientationPanel({ setting, onSettingChange }: RemoteVideoOrientationPanelProps) {
  return (
    <section className="video-orientation-panel" aria-label="画面方向">
      <div className="video-source-caption">画面方向</div>
      <div className="control-field">
        <span className="control-field-label">旋转</span>
        <SegmentedControl
          name="remoteVideoRotation"
          ariaLabel="画面旋转"
          columns={5}
          value={String(setting.rotation)}
          onChange={(value) => onSettingChange({ ...setting, rotation: toRotationSetting(value) })}
          options={ROTATION_OPTIONS}
        />
      </div>
      <div className="control-field">
        <span className="control-field-label">翻转</span>
        <SegmentedControl
          name="remoteVideoFlip"
          ariaLabel="画面翻转"
          columns={3}
          value={setting.flip}
          onChange={(value) => onSettingChange({ ...setting, flip: value })}
          options={FLIP_OPTIONS}
        />
      </div>
      <p className="field-hint">
        跟随时按被控端上报的方向摆正，上报缺失或者不对时自己选角度。点击位置按你看到的画面算。
      </p>
    </section>
  );
}

function toRotationSetting(value: string): RemoteVideoRotationSetting {
  return value === "auto" ? "auto" : (Number(value) as RemoteVideoRotation);
}
