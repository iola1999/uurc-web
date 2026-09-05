import { cleanup } from "@testing-library/react";
import { vi } from "vitest";

import AppComponent from "../src/App.js";
import { appBackend, handleFetch } from "./appBackendFixture.js";
import { TestPeerConnection } from "./appBrowserFakes.js";
import { waitForRoomRelease } from "../src/controllers/remoteRoomLifecycle.js";

export const App = AppComponent;

const clipboardMocks = vi.hoisted(() => ({
  read: vi.fn(async () => ""),
  write: vi.fn(async (_text: string) => undefined),
}));
export const readLocalClipboardTextMock = clipboardMocks.read;
export const writeLocalClipboardTextMock = clipboardMocks.write;

vi.mock("../src/browser/clipboard.js", () => ({
  getLocalClipboardAccessIssue: () => null,
  readLocalClipboardText: readLocalClipboardTextMock,
  writeLocalClipboardText: writeLocalClipboardTextMock,
}));

export const authReady = {
  hasState: true,
  missingFields: [],
  userId: "user-1",
  clientId: "client-1",
  deviceId: "web-device-1",
  channel: "official",
};

export function setupAppTest(): void {
  appBackend.requestLog = [];
  appBackend.joinRoomFailure = false;
  appBackend.lastControlIceId = "";
  appBackend.currentControlForceRelay = false;
  appBackend.currentAssistControlMode = "by_password";
  appBackend.currentAssistPlatformFields = { publisher_platform: 4, device_platform: 2, platform: 1 };
  appBackend.assistCodeRequiresConfirmation = false;
  appBackend.currentSignalServers = ["wss://signal.example"];
  appBackend.signalStartError = false;
  appBackend.remoteTrackPlan = [];
  appBackend.currentParticipants = [
    {
      client_id: "client-phone-1",
      device_id: "phone-1",
      alias: "iPhone",
      platform: 3,
      user_join_type: 1,
      controlled_time: 180,
      app_flag: { control_mode: "second_screen" },
    },
    {
      client_id: "client-mac-1",
      device_id: "mac-1",
      alias: "Studio Mac",
      platform: 4,
      user_join_type: 1,
      controlled_time: 180,
      app_flag: { control_mode: null },
    },
  ];
  appBackend.currentRemoteSignalEvents = [
    {
      id: 1,
      direction: "inbound",
      event: "soac",
      receivedAt: "2026-05-14T00:00:00.200Z",
      payload: [
        {
          client_id: "controlled-1",
          data: {
            type: "answer",
            sdp: "v=0 answer",
          },
        },
      ],
    },
  ];
  TestPeerConnection.lastConfiguration = null;
  TestPeerConnection.current = null;
  TestPeerConnection.sentByLabel = {};
  TestPeerConnection.channels = {};
  TestPeerConnection.closed = false;
  TestPeerConnection.statsReports = [];
  readLocalClipboardTextMock.mockReset();
  readLocalClipboardTextMock.mockResolvedValue("");
  writeLocalClipboardTextMock.mockReset();
  writeLocalClipboardTextMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  window.localStorage.setItem("uurc.autoConnect", "false");
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/devices");
  seedLoginState(authReady);
  vi.stubGlobal("fetch", vi.fn(handleFetch));
}

export async function cleanupAppTest(): Promise<void> {
  cleanup();
  await Promise.resolve();
  await waitForRoomRelease();
  vi.unstubAllGlobals();
}

export function seedLoginState(status: typeof authReady): void {
  window.localStorage.setItem(
    "uurc.loginState",
    JSON.stringify({
      token: "header.payload.signature",
      userId: status.userId,
      clientId: status.clientId,
      deviceId: status.deviceId,
      channel: status.channel,
    }),
  );
}
