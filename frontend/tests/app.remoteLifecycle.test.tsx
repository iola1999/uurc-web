import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appBackend, uuCalls } from "./appBackendFixture.js";
import { FakeMediaStream, TestPeerConnection } from "./appBrowserFakes.js";
import {
  expectSignalState,
  getPrimaryAction,
  openAdvancedSettings,
  openOfficeMacControl,
  startCompatibleConnection,
} from "./appTestActions.js";
import { App, cleanupAppTest, setupAppTest } from "./appTestEnvironment.js";

describe("App remote lifecycle", () => {
  beforeEach(setupAppTest);
  afterEach(cleanupAppTest);

  it("passes takeover in the first join request and releases the room on route unmount", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await user.click(await screen.findByRole("button", { name: /^接管控制/ }));
    await waitFor(() =>
      expect(uuCalls("/api/v1/room/join/by_device/desktop-1")[0]?.body).toEqual({ force_join: true }),
    );
    await waitFor(() =>
      expect(appBackend.requestLog.some((call) => call.path === "/api/remote/signal/control")).toBe(true),
    );
    unmount();
    await waitFor(() => expect(uuCalls("/api/v1/room/clear/by_device/desktop-1")).toHaveLength(1));
    expect(
      appBackend.requestLog.filter((call) => call.method === "DELETE" && call.path === "/api/remote/signal"),
    ).toHaveLength(1);
  });

  it("preserves a control page deep link while restoring login state on refresh", async () => {
    window.history.replaceState(null, "", "/devices/desktop-1/control");

    render(<App />);

    await screen.findByRole("heading", { name: "Office Mac" }, { timeout: 5_000 });
    expect(window.location.pathname).toBe("/devices/desktop-1/control");
    expect(screen.getByRole("application", { name: "远控画面" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "我的设备" })).not.toBeInTheDocument();
  });

  it("defers room join until the operator starts the connection from the control page", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "我的设备" });
    await user.click(await screen.findByRole("button", { name: /连接 Office Mac/ }));
    await screen.findByRole("heading", { name: "Office Mac" });

    expect(uuCalls("/api/v1/room/join/by_device/desktop-1")).toHaveLength(0);
    await startCompatibleConnection(user);

    await waitFor(() => {
      expect(uuCalls("/api/v1/room/join/by_device/desktop-1")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
  });

  it("joins a room by device with the selected join mode and route policy", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await openAdvancedSettings(user);
    await user.click(screen.getByRole("radio", { name: "兼容模式" }));
    await user.click(screen.getByRole("radio", { name: "接管控制" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "接管控制" })).toBeChecked();
    });
    await user.click(getPrimaryAction("接管并开始连接"));
    await waitFor(() => {
      expect(uuCalls("/api/v1/room/join/by_device/desktop-1")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
  });

  it("starts the remote view from the connection action without a second click", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);

    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "打开远控画面" })).not.toBeInTheDocument();
  });

  it("starts the signal gateway from the first room signal entry", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    appBackend.currentSignalServers = ["wss://signal-a.example", "wss://signal-b.example"];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);

    await waitFor(() => {
      const startCalls = appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start");
      expect(startCalls.at(-1)?.body).toMatchObject({ gzipSdp: false });
      expect(startCalls.at(-1)?.body).toHaveProperty("roomConfig.token", "room-token-1");
    });
    expect(screen.getByText("wss://signal-a.example")).toBeInTheDocument();
  });

  it("asks the operator to rejoin the room when the signal gateway rejects a stale RoomConfig", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    appBackend.signalStartError = true;
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);

    await screen.findByText("连接失败：websocket error");
    expect(getPrimaryAction("重新开始连接")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "打开远控画面" })).not.toBeInTheDocument();
  });

  it("shows the upstream room join blocker when the service refuses an occupied target", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.joinRoomFailure = true;
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user, { waitForReady: false });
    await user.click(getPrimaryAction("开始连接"));
    await user.click(await screen.findByRole("button", { name: /^接管控制/ }));

    await waitFor(() => {
      expect(document.body.textContent).toContain("服务端拒绝加入房间");
    });
    expect(screen.queryByRole("button", { name: "打开远控画面" })).not.toBeInTheDocument();
  });

  it("respects service-requested relay while the operator keeps automatic routing", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentControlForceRelay = true;
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await openAdvancedSettings(user);
    await user.click(screen.getByRole("radio", { name: "兼容模式" }));
    expect(screen.getByRole("radio", { name: "自动路径" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "接管控制" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "接管控制" })).toBeChecked();
    });
    await user.click(getPrimaryAction("接管并开始连接"));
    await waitFor(() => {
      expect(uuCalls("/api/v1/room/join/by_device/desktop-1")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getAllByText("接管加入").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expectSignalState("已连接");
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "打开远控画面" })).not.toBeInTheDocument();

    expect(TestPeerConnection.lastConfiguration).toMatchObject({ iceTransportPolicy: "relay" });
    expect(screen.getByRole("radio", { name: "自动路径" })).toBeChecked();
    expect(screen.getAllByText("服务端要求中转").length).toBeGreaterThan(0);
  });

  it("auto-enables remote input control once the control channel opens", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expectSignalState("已连接");
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "打开远控画面" })).not.toBeInTheDocument();

    // 连接后默认进入控制状态：自动启用输入控制并聚焦画面，无需手动点一下。
    const controlSegment = await screen.findByRole("button", { name: "控制中" });
    expect(controlSegment).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toHaveAttribute("aria-label", "远控画面");

    // 忠实按键:普通键在 keydown 即同步发「按下+抬起」一对(瞬时一击)，不在被控端留下“按住”状态。
    const controlSentBefore = TestPeerConnection.sentByLabel.CONTROL_DATA_CHANNEL?.length ?? 0;
    await user.keyboard("a");
    const controlSentAfter = TestPeerConnection.sentByLabel.CONTROL_DATA_CHANNEL?.length ?? 0;
    expect(controlSentAfter - controlSentBefore).toBeGreaterThanOrEqual(2);

    // 点“仅查看”暂停操作，开关切回仅查看态。
    await user.click(screen.getByRole("button", { name: "仅查看" }));
    expect(screen.getByRole("button", { name: "仅查看" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "控制中" })).toHaveAttribute("aria-pressed", "false");
  });

  it("surfaces one-click reconnect after the control channel drops and reuses the current room", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    await user.click(screen.getByRole("tab", { name: "状态" }));
    await user.click(screen.getByRole("checkbox", { name: "自动重连" }));

    TestPeerConnection.closeDataChannel("CONTROL_DATA_CHANNEL");

    await screen.findByText(/控制连接已断开/);
    const reconnectButton = screen.getByRole("button", { name: "立即重连" });
    expect(reconnectButton).toBeEnabled();

    await user.click(reconnectButton);

    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(2);
    });
    expect(uuCalls("/api/v1/room/join/by_device/desktop-1")).toHaveLength(1);
    expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(1);
  });

  it("auto reconnects recoverable sessions without rejoining the UU room", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });

    TestPeerConnection.closeDataChannel("CONTROL_DATA_CHANNEL");

    await waitFor(
      () => {
        expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(2);
      },
      { timeout: 2500 },
    );
    expect(uuCalls("/api/v1/room/join/by_device/desktop-1")).toHaveLength(1);
  });

  it("shows a first-class disconnect action that closes the browser remote session", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expectSignalState("已连接");
    });
    await screen.findByRole("button", { name: "断开" });

    await user.click(screen.getByRole("button", { name: "断开" }));

    await waitFor(() => {
      expect(appBackend.requestLog.some((call) => call.method === "DELETE" && call.path === "/api/remote/signal")).toBe(
        true,
      );
    });
    const deleteCallIndex = appBackend.requestLog.findIndex(
      (call) => call.method === "DELETE" && call.path === "/api/remote/signal",
    );
    await waitFor(() => {
      expect(
        appBackend.requestLog
          .slice(deleteCallIndex + 1)
          .some((call) => call.method === "GET" && call.path === "/api/v1/device/groups/of/my"),
      ).toBe(true);
    });
    expect(TestPeerConnection.closed).toBe(true);
    expect(screen.getAllByText("已关闭").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已释放房间").length).toBeGreaterThan(0);
  });

  it("disconnects the active remote session before returning to the device list", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expectSignalState("已连接");
    });

    await user.click(screen.getByRole("button", { name: "返回设备列表" }));

    await screen.findByRole("heading", { name: "我的设备" });
    expect(window.location.pathname).toBe("/devices");
    await waitFor(() => {
      expect(appBackend.requestLog.some((call) => call.method === "DELETE" && call.path === "/api/remote/signal")).toBe(
        true,
      );
    });
    expect(TestPeerConnection.closed).toBe(true);
    expect(screen.queryByRole("heading", { name: "Office Mac" })).not.toBeInTheDocument();
  });

  it("keeps extra incoming video tracks out of the main remote-control surface", async () => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    appBackend.remoteTrackPlan = [
      { id: "blank-video", kind: "video" },
      { id: "desktop-video", kind: "video" },
      { id: "remote-audio", kind: "audio" },
    ];
    const user = userEvent.setup();
    render(<App />);

    await openOfficeMacControl(user);
    await startCompatibleConnection(user);
    await waitFor(() => {
      expectSignalState("已连接");
    });
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "打开远控画面" })).not.toBeInTheDocument();

    await screen.findByLabelText("远控画面视频");
    expect(screen.queryByLabelText("远控视频 2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "状态" }));
    expect(screen.getByRole("region", { name: "画面源" })).toBeInTheDocument();
    expect(screen.getByText(/2 路视频/)).toBeInTheDocument();
  });
});
