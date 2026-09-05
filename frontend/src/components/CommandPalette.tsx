import { ChevronRight, Handshake, Monitor, RefreshCw, Search } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { CommandPaletteController } from "../controllers/useCommandPaletteController.js";
import { isDeviceOnline } from "../devices/deviceLabels.js";
import { dialogCardVariants, dialogScrimVariants } from "../motion/presets.js";
import { preloadRemoteControlRoute } from "../routeLoaders.js";
import { useModalFocus } from "./ui/useModalFocus.js";

const paletteLayoutTransition = { type: "spring" as const, stiffness: 520, damping: 40, mass: 0.7 };

export function CommandPalette({
  open,
  query,
  matches,
  setOpen,
  setQuery,
  onSelectDevice,
  onConnectByIdFromQuery,
  onRefresh,
}: CommandPaletteController) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, open, () => setOpen(false));
  const firstMatch = matches[0];

  useEffect(() => {
    if (open) {
      preloadRemoteControlRoute();
      inputRef.current?.focus();
    }
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <m.div
          key="command-palette"
          className="command-palette-scrim"
          variants={dialogScrimVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <m.div
            className="command-palette-card"
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            variants={dialogCardVariants}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target === inputRef.current &&
                !event.nativeEvent.isComposing &&
                firstMatch
              ) {
                event.preventDefault();
                onSelectDevice(firstMatch.deviceId);
              }
            }}
          >
            <div className="command-palette-search">
              <Search size={16} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索设备，或按设备 ID 直连伙伴…"
                aria-label="搜索设备或操作"
              />
              <kbd>esc</kbd>
            </div>
            <div className="command-palette-body">
              <AnimatePresence initial={false} mode="popLayout">
                {matches.length > 0 ? (
                  <m.div
                    key="device-results"
                    className="command-palette-device-results"
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={paletteLayoutTransition}
                  >
                    <div className="command-palette-section-label">设备</div>
                    {matches.map((device, index) => (
                      <m.button
                        key={device.deviceId}
                        type="button"
                        layout="position"
                        transition={paletteLayoutTransition}
                        whileTap={{ scale: 0.995 }}
                        className={`command-palette-row${index === 0 ? " is-active" : ""}`}
                        onClick={() => onSelectDevice(device.deviceId)}
                      >
                        <span
                          className={`command-palette-dot ${isDeviceOnline(device) ? "is-online" : "is-offline"}`}
                        />
                        <Monitor size={16} />
                        <span className="command-palette-row-label">{device.alias}</span>
                        <span className="command-palette-row-hint">
                          连接
                          <kbd>↵</kbd>
                        </span>
                      </m.button>
                    ))}
                  </m.div>
                ) : null}
              </AnimatePresence>
              <m.div className="command-palette-actions" layout="position" transition={paletteLayoutTransition}>
                <div className="command-palette-section-label">操作</div>
                <m.button
                  type="button"
                  layout="position"
                  transition={paletteLayoutTransition}
                  whileTap={{ scale: 0.995 }}
                  className="command-palette-row"
                  onClick={onConnectByIdFromQuery}
                >
                  <Handshake size={15} />
                  <span className="command-palette-row-label">按设备 ID 连接伙伴设备…</span>
                  <ChevronRight size={13} className="command-palette-row-chevron" />
                </m.button>
                <m.button
                  type="button"
                  layout="position"
                  transition={paletteLayoutTransition}
                  whileTap={{ scale: 0.995 }}
                  className="command-palette-row"
                  onClick={() => {
                    onRefresh();
                    setOpen(false);
                  }}
                >
                  <RefreshCw size={15} />
                  <span className="command-palette-row-label">刷新设备列表</span>
                  <kbd>R</kbd>
                </m.button>
              </m.div>
            </div>
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
