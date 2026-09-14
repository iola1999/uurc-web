import { ChevronRight, Monitor, Smartphone, Tv } from "lucide-react";
import { AnimatePresence, LayoutGroup, type Transition, type Variants } from "motion/react";
import * as m from "motion/react-m";
import { useId } from "react";

import type { UuDeviceGroups } from "@uurc/shared/devices";

import {
  categorizeDeviceGroups,
  getDeviceControlLabel,
  isDeviceOnline,
  type CategorizedDevice,
  type DeviceCategory,
} from "../devices/deviceLabels.js";
import { preloadRemoteControlRoute } from "../routeLoaders.js";
import { AnimatedDisclosure } from "./ui/AnimatedDisclosure.js";

const CATEGORY_ICON: Record<DeviceCategory, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tv: Tv,
};

const DEVICE_LAYOUT_TRANSITION = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1],
} satisfies Transition;

const DEVICE_ROW_TRANSITION = {
  layout: DEVICE_LAYOUT_TRANSITION,
  opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
  y: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  scale: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
} satisfies Transition;

const DEVICE_ROW_VARIANTS = {
  initial: { opacity: 0, y: -5, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.995 },
} satisfies Variants;

const DEVICE_SECTION_VARIANTS = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
} satisfies Variants;

const DEVICE_SECTION_TRANSITION = {
  layout: DEVICE_LAYOUT_TRANSITION,
  opacity: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
  y: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
} satisfies Transition;

// 平铺展示：不再按设备类型分区块，而是按在线/离线分组，类型只作为行内说明文字。
export function DeviceList({
  devices,
  loading,
  currentDeviceId,
  onSelect,
  onConnect,
}: {
  devices: UuDeviceGroups;
  loading?: boolean;
  currentDeviceId?: string;
  onSelect: (deviceId: string) => void;
  onConnect: (deviceId: string) => void;
}) {
  const layoutGroupId = useId();
  const categorized = categorizeDeviceGroups(devices);
  const online = categorized.filter((entry) => isDeviceOnline(entry.device));
  const offline = categorized.filter((entry) => !isDeviceOnline(entry.device));

  const renderRow = (entry: CategorizedDevice) => {
    const { device, category, categoryLabel } = entry;
    const online = isDeviceOnline(device);
    const Icon = CATEGORY_ICON[category];
    const controlLabel = getDeviceControlLabel(device);
    const canConnect = online && device.controllable && device.deviceId !== currentDeviceId;

    const body = (
      <>
        <span className={`device-row-dot ${online ? "is-online" : "is-offline"}`} aria-hidden="true" />
        <Icon size={17} className="device-row-icon" aria-hidden="true" />
        <span className="device-row-body">
          <span className="device-row-name">{device.alias}</span>
          {device.deviceId === currentDeviceId ? <span className="device-row-badge">本次登录设备</span> : null}
        </span>
        <span className="device-row-meta">
          {categoryLabel} · {controlLabel || (online ? "在线" : "离线")}
          {device.versionName ? ` · v${device.versionName}` : ""}
        </span>
        {canConnect ? (
          <button
            type="button"
            className="primary-action-button device-row-connect"
            aria-label={`连接 ${device.alias}`}
            onFocus={preloadRemoteControlRoute}
            onMouseEnter={preloadRemoteControlRoute}
            onPointerDown={preloadRemoteControlRoute}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(device.deviceId);
              onConnect(device.deviceId);
            }}
          >
            连接
            <ChevronRight size={13} />
          </button>
        ) : null}
      </>
    );

    return (
      <m.div
        key={device.deviceId}
        className={`device-row${online ? " device-row-online" : " device-row-offline"}`}
        layout="position"
        layoutId={`device-row-${device.deviceId}`}
        variants={DEVICE_ROW_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={DEVICE_ROW_TRANSITION}
      >
        {body}
      </m.div>
    );
  };

  return (
    <LayoutGroup id={layoutGroupId}>
      <AnimatePresence initial={false} mode="popLayout">
        {categorized.length === 0 ? (
          <m.p
            key="device-list-empty"
            className="empty-text"
            layout="position"
            variants={DEVICE_SECTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={DEVICE_SECTION_TRANSITION}
          >
            {loading ? "正在加载设备…" : "暂无设备"}
          </m.p>
        ) : (
          <m.div
            key="device-list-content"
            className="device-list-content"
            layout="position"
            variants={DEVICE_SECTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={DEVICE_SECTION_TRANSITION}
          >
            <m.div className="device-group-label" layout="position" transition={DEVICE_LAYOUT_TRANSITION}>
              <span>在线 · {online.length}</span>
              <span className="device-group-rule" />
            </m.div>

            <AnimatePresence initial={false} mode="popLayout">
              {online.length ? (
                <m.div
                  key="online-device-frame"
                  className="device-rows-frame"
                  layout
                  variants={DEVICE_SECTION_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={DEVICE_SECTION_TRANSITION}
                >
                  <m.div className="device-rows" layout transition={DEVICE_LAYOUT_TRANSITION}>
                    <AnimatePresence initial={false} mode="popLayout">
                      {online.map(renderRow)}
                    </AnimatePresence>
                  </m.div>
                </m.div>
              ) : (
                <m.p
                  key="online-device-empty"
                  className="empty-text device-online-empty"
                  layout="position"
                  variants={DEVICE_SECTION_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={DEVICE_SECTION_TRANSITION}
                >
                  暂无在线设备
                </m.p>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false} mode="popLayout">
              {offline.length ? (
                <m.div
                  key="offline-device-section"
                  layout
                  variants={DEVICE_SECTION_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={DEVICE_SECTION_TRANSITION}
                >
                  <AnimatedDisclosure
                    className="device-offline-section"
                    defaultOpen
                    summary={
                      <span className="device-group-label">
                        <span>离线 · {offline.length}</span>
                        <span className="device-group-rule" />
                        <span className="device-group-collapse-hint" aria-hidden="true" />
                      </span>
                    }
                  >
                    <m.div className="device-rows-frame" layout transition={DEVICE_LAYOUT_TRANSITION}>
                      <m.div className="device-rows" layout transition={DEVICE_LAYOUT_TRANSITION}>
                        <AnimatePresence initial={false} mode="popLayout">
                          {offline.map(renderRow)}
                        </AnimatePresence>
                      </m.div>
                    </m.div>
                  </AnimatedDisclosure>
                </m.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false} mode="popLayout">
              {devices.tvDevices.length === 0 ? (
                <m.p
                  key="tv-device-empty"
                  className="device-empty-hint"
                  layout="position"
                  variants={DEVICE_SECTION_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={DEVICE_SECTION_TRANSITION}
                >
                  <Tv size={13} aria-hidden="true" />
                  TV · 暂无设备
                </m.p>
              ) : null}
            </AnimatePresence>
          </m.div>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}
