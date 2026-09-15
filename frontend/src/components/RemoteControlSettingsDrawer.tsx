import { CircleStop, LoaderCircle, Monitor, PlugZap } from "lucide-react";
import { useEffect, useId, useState } from "react";

import type { UuDevice, UuParticipantInfo } from "@uurc/shared/devices";
import type { FingerprintClientType, FingerprintConfig, FingerprintPresetId } from "@uurc/shared/fingerprint";

import type {
  BusyAction,
  ConnectionRouteMode,
  SdpTransportMode,
  SignalChannelMode,
} from "../app/remoteControlTypes.js";
import { ParticipantList } from "./ParticipantList.js";
import { AnimatedDisclosure } from "./ui/AnimatedDisclosure.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";
import { Switch } from "./ui/Switch.js";

export interface RemoteControlSettingsDrawerProps {
  autoConnect: boolean;
  browserRtcReady: boolean;
  busy: BusyAction;
  connectionRouteMode: ConnectionRouteMode;
  directSignalExtensionHint: string;
  fingerprint: FingerprintConfig;
  forceJoin: boolean;
  onAutoConnectChange: (enabled: boolean) => void;
  onConnectionRouteModeChange: (mode: ConnectionRouteMode) => void;
  onFingerprintPatch: (patch: Partial<FingerprintConfig>) => void;
  onFingerprintPreset: (preset: FingerprintPresetId) => void;
  onForceJoinChange: (forceJoin: boolean) => void;
  onSignalChannelModeChange: (mode: SignalChannelMode) => void;
  onSignalServerIndexChange: (index: number) => void;
  onSdpTransportModeChange: (mode: SdpTransportMode) => void;
  onStartBrowserRemote: () => void;
  onStartSignalGateway: () => void;
  onStopSignalGateway: () => void;
  sdpTransportMode: SdpTransportMode;
  selectedDevice: UuDevice | null;
  selectedParticipants: UuParticipantInfo[];
  signalChannelMode: SignalChannelMode;
  signalServerIndex: number;
  signalServerOptions: string[];
}

export function RemoteControlSettingsDrawer({
  autoConnect,
  browserRtcReady,
  busy,
  connectionRouteMode,
  directSignalExtensionHint,
  fingerprint,
  forceJoin,
  onAutoConnectChange,
  onConnectionRouteModeChange,
  onFingerprintPatch,
  onFingerprintPreset,
  onForceJoinChange,
  onSignalChannelModeChange,
  onSignalServerIndexChange,
  onSdpTransportModeChange,
  onStartBrowserRemote,
  onStartSignalGateway,
  onStopSignalGateway,
  sdpTransportMode,
  selectedDevice,
  selectedParticipants,
  signalChannelMode,
  signalServerIndex,
  signalServerOptions,
}: RemoteControlSettingsDrawerProps) {
  return (
    <div className="control-settings-tab">
      <Switch checked={autoConnect} label="进入设备自动连接" onChange={onAutoConnectChange} />
      {selectedDevice ? (
        <div className="control-field">
          <span className="control-field-label">正在占用该设备的控制端</span>
          <ParticipantList participants={selectedParticipants} />
        </div>
      ) : null}
      {selectedDevice ? (
        <div className="control-field">
          <span className="control-field-label">加入模式</span>
          <SegmentedControl
            name="joinMode"
            ariaLabel="加入模式"
            value={forceJoin ? "force" : "normal"}
            onChange={(value) => onForceJoinChange(value === "force")}
            options={[
              { value: "normal", label: "普通加入" },
              { value: "force", label: "接管控制" },
            ]}
          />
        </div>
      ) : null}

      <AnimatedDisclosure
        className="control-subdrawer"
        contentClassName="control-subdrawer-content"
        summary="高级设置（调试用）"
      >
        <div className="transport-actions">
          <button onClick={onStartSignalGateway} disabled={busy !== null}>
            {busy === "signal-start" ? <LoaderCircle className="spin" size={17} /> : <PlugZap size={17} />}
            手动启动连接服务
          </button>
          <button onClick={onStopSignalGateway} disabled={busy !== null}>
            {busy === "signal-stop" ? <LoaderCircle className="spin" size={17} /> : <CircleStop size={17} />}
            手动断开连接
          </button>
          <button onClick={onStartBrowserRemote} disabled={!browserRtcReady}>
            {busy === "browser-remote-start" ? <LoaderCircle className="spin" size={17} /> : <Monitor size={17} />}
            手动启动画面
          </button>
        </div>
        {signalServerOptions.length > 0 ? (
          <label className="control-field select-field" htmlFor="signal-server-index">
            <span className="control-field-label">信令入口</span>
            <select
              id="signal-server-index"
              aria-label="信令入口"
              value={signalServerIndex}
              onChange={(event) => onSignalServerIndexChange(Number(event.target.value))}
            >
              {signalServerOptions.map((server, index) => (
                <option key={`${server}-${index}`} value={index}>
                  {server}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="control-field">
          <span className="control-field-label">画面兼容性</span>
          <SegmentedControl
            name="sdpTransportMode"
            ariaLabel="画面协商"
            value={sdpTransportMode}
            onChange={onSdpTransportModeChange}
            options={[
              { value: "gzip", label: "标准模式" },
              { value: "plain", label: "兼容模式" },
            ]}
          />
        </div>
        <div className="control-field">
          <span className="control-field-label">网络路径</span>
          <SegmentedControl
            name="connectionRouteMode"
            ariaLabel="网络路径"
            value={connectionRouteMode}
            onChange={onConnectionRouteModeChange}
            options={[
              { value: "auto", label: "自动路径" },
              { value: "relay", label: "强制 UU 中转" },
            ]}
          />
        </div>
        <div className="control-field">
          <span className="control-field-label">信令通道</span>
          <SegmentedControl
            name="signalChannelMode"
            ariaLabel="信令通道"
            value={signalChannelMode}
            onChange={onSignalChannelModeChange}
            options={[
              { value: "auto", label: "自动" },
              { value: "gateway", label: "部署侧网关" },
              { value: "direct", label: "浏览器直连" },
            ]}
          />
          <p className="field-hint">{directSignalExtensionHint}</p>
        </div>
        <div className="control-field">
          <span className="control-field-label">客户端指纹</span>
          <SegmentedControl
            name="fingerprintPreset"
            ariaLabel="客户端指纹"
            value={fingerprint.preset}
            onChange={onFingerprintPreset}
            options={[
              { value: "android-v4", label: "默认" },
              { value: "android-legacy", label: "旧版 4.23" },
              { value: "custom", label: "自定义" },
            ]}
          />
        </div>
        <AnimatedDisclosure
          className="control-subdrawer"
          contentClassName="control-subdrawer-content"
          summary="指纹参数"
        >
          <FingerprintTextField
            label="信令版本"
            value={fingerprint.streamerVersion}
            onCommit={(value) => onFingerprintPatch({ streamerVersion: value })}
          />
          <FingerprintTextField
            label="版本名（VN）"
            value={fingerprint.appVersionName}
            onCommit={(value) => onFingerprintPatch({ appVersionName: value })}
          />
          <FingerprintTextField
            label="版本号（VC）"
            value={fingerprint.appVersionCode}
            onCommit={(value) => onFingerprintPatch({ appVersionCode: value })}
          />
          <FingerprintTextField
            label="平台（PLAT）"
            value={fingerprint.httpPlatform}
            onCommit={(value) => onFingerprintPatch({ httpPlatform: value })}
          />
          <label className="control-field select-field" htmlFor="fingerprint-client-type">
            <span className="control-field-label">客户端类型</span>
            <select
              id="fingerprint-client-type"
              aria-label="客户端类型"
              value={String(fingerprint.clientType)}
              onChange={(event) =>
                onFingerprintPatch({
                  // normalize 会校验取值,非法值回落默认
                  clientType:
                    event.target.value === "auto" ? "auto" : (Number(event.target.value) as FingerprintClientType),
                })
              }
            >
              <option value="auto">自动（跟随被控端）</option>
              <option value="2">Android</option>
              <option value="1">iOS</option>
              <option value="3">Windows</option>
              <option value="4">Mac</option>
            </select>
          </label>
          <p className="field-hint">
            信令版本在「手动断开连接」后重新「手动启动连接服务」生效；其余字段在下次请求或下次启动画面时生效。
          </p>
        </AnimatedDisclosure>
      </AnimatedDisclosure>
    </div>
  );
}

// 失焦提交:输入过程中保留草稿,非法值被 normalize 拒绝时回退到当前生效值
function FingerprintTextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const fieldId = useId();
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="control-field" htmlFor={fieldId}>
      <span className="control-field-label">{label}</span>
      <input
        id={fieldId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          onCommit(draft.trim());
          setDraft(value);
        }}
      />
    </label>
  );
}
