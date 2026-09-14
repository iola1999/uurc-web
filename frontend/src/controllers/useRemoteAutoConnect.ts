import { useEffect, useRef } from "react";

import type { BusyAction } from "../app/remoteControlTypes.js";
import type { BrowserRemoteSessionState } from "../remote/browserRemoteSessionTypes.js";

interface RemoteAutoConnectOptions {
  autoConnect: boolean;
  browserStage: BrowserRemoteSessionState["stage"];
  busy: BusyAction;
  devicesLoaded: boolean;
  loggedIn: boolean;
  occupiedByOthers: boolean;
  remoteAssistanceActive: boolean;
  resumeAllowed: boolean;
  selectedDeviceExists: boolean;
  selectedDeviceId: string;
  selectedDeviceIsCurrentAuthDevice: boolean;
  signalGatewayState: string;
  onConnect(): Promise<void>;
}

export function useRemoteAutoConnect(options: RemoteAutoConnectOptions): void {
  const attemptedDeviceRef = useRef("");
  const onConnectRef = useRef(options.onConnect);
  onConnectRef.current = options.onConnect;

  useEffect(() => {
    if (
      !options.autoConnect ||
      !options.resumeAllowed ||
      !options.loggedIn ||
      !options.selectedDeviceId ||
      options.selectedDeviceIsCurrentAuthDevice ||
      options.occupiedByOthers ||
      options.busy !== null ||
      options.browserStage !== "idle" ||
      options.signalGatewayState === "connected" ||
      attemptedDeviceRef.current === options.selectedDeviceId ||
      (!options.remoteAssistanceActive && (!options.devicesLoaded || !options.selectedDeviceExists))
    ) {
      return;
    }

    attemptedDeviceRef.current = options.selectedDeviceId;
    void onConnectRef.current();
  }, [
    options.autoConnect,
    options.browserStage,
    options.busy,
    options.devicesLoaded,
    options.loggedIn,
    options.occupiedByOthers,
    options.remoteAssistanceActive,
    options.resumeAllowed,
    options.selectedDeviceExists,
    options.selectedDeviceId,
    options.selectedDeviceIsCurrentAuthDevice,
    options.signalGatewayState,
  ]);
}
