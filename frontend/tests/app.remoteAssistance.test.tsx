import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDefaultStreamerConnectOptionsBase64 } from "@uurc/shared/streamer/connectOptions";
import { STREAMER_CLIENT_TYPES, STREAMER_CONTROL_CONNECT_TYPES } from "@uurc/shared/streamer/connectOptionsModel";
import { appBackend, uuCalls } from "./appBackendFixture.js";
import { TestPeerConnection } from "./appBrowserFakes.js";
import { startCompatibleConnection } from "./appTestActions.js";
import { App, cleanupAppTest, setupAppTest } from "./appTestEnvironment.js";

describe("App remote assistance", () => {
  beforeEach(setupAppTest);
  afterEach(cleanupAppTest);

  it("starts a partner remote-assistance session by device ID and code", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "我的设备" });
    await user.click(screen.getByRole("link", { name: /远控伙伴/ }));
    await screen.findByRole("heading", { name: "远控伙伴" });
    expect(
      within(screen.getByRole("region", { name: "远控伙伴设备" })).queryByRole("combobox"),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("伙伴的设备 ID"), "982123456");
    await user.type(screen.getByLabelText(/设备验证码/), "L6026CCD");
    await user.click(screen.getByRole("button", { name: "发起连接" }));

    await screen.findByRole("heading", { name: "Partner PC" });
    expect(window.location.pathname).toBe("/devices/982123456/control");
    expect(uuCalls("/api/v2/room/share/control_mode")).toHaveLength(1);
    expect(uuCalls("/api/v2/room/join/share/by_code")).toHaveLength(1);

    await startCompatibleConnection(user);

    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(1);
    });
    const startCall = appBackend.requestLog.find((call) => call.path === "/api/remote/signal/start");
    expect(startCall?.body).toHaveProperty("roomConfig.token", "assist-room-token");
    expect(startCall?.body).toHaveProperty("joinContext.kind", "remote_assistance");
    expect(startCall?.body).toHaveProperty("joinContext.connectId", "982123456");
    expect(startCall?.body).toHaveProperty("joinContext.targetPlatform", 4);

    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/control")).toHaveLength(1);
    });
    const controlCall = appBackend.requestLog.find((call) => call.path === "/api/remote/signal/control");
    expect(controlCall?.body).toMatchObject({
      appDataBase64: buildDefaultStreamerConnectOptionsBase64({
        deviceId: "web-device-1",
        clientType: STREAMER_CLIENT_TYPES.Client_MAC,
        controlConnectType: STREAMER_CONTROL_CONNECT_TYPES.ControlConnectType_Assistance,
        cursorCapture: false,
      }),
    });

    await user.click(screen.getByRole("button", { name: "断开" }));

    await waitFor(() => {
      expect(appBackend.requestLog.some((call) => call.method === "DELETE" && call.path === "/api/remote/signal")).toBe(
        true,
      );
    });
    await waitFor(() => {
      expect(uuCalls("/api/v2/room/share/cancel_remote_assist")).toHaveLength(1);
    });
    await screen.findByRole("heading", { name: "远控伙伴" });
    expect(screen.getByLabelText("伙伴的设备 ID")).toHaveValue("982123456");
  });

  it("waits for partner confirmation when the verification code is left empty", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    appBackend.currentAssistControlMode = "password_confirmation";
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "我的设备" });
    await user.click(screen.getByRole("link", { name: /远控伙伴/ }));
    await screen.findByRole("heading", { name: "远控伙伴" });
    await user.type(screen.getByLabelText("伙伴的设备 ID"), "982123456");
    // 故意不填验证码：应直接走“等待对方确认”
    await user.click(screen.getByRole("button", { name: "发起连接" }));

    await screen.findByRole("heading", { name: "Partner PC" });
    expect(window.location.pathname).toBe("/devices/982123456/control");
    expect(uuCalls("/api/v2/room/join/share/by_code")).toHaveLength(0);
    expect(uuCalls("/api/v2/room/join/share/by_confirmation")).toHaveLength(1);
  });

  it("continues by code through partner confirmation with the detected platform", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    appBackend.currentAssistControlMode = "password_confirmation";
    appBackend.assistCodeRequiresConfirmation = true;
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "我的设备" });
    await user.click(screen.getByRole("link", { name: /远控伙伴/ }));
    await screen.findByRole("heading", { name: "远控伙伴" });
    await user.type(screen.getByLabelText("伙伴的设备 ID"), "982123456");
    await user.type(screen.getByLabelText(/设备验证码/), "L6026CCD");
    await user.click(screen.getByRole("button", { name: "发起连接" }));

    await screen.findByRole("heading", { name: "Partner PC" });
    expect(uuCalls("/api/v2/room/join/share/by_code")).toHaveLength(1);
    expect(uuCalls("/api/v2/room/join/share/by_confirmation")).toHaveLength(1);
    expect(uuCalls("/api/v2/room/join/share/by_confirmation")[0]?.body).toEqual({
      connect_id: "982123456",
      control_id: "assist-control-1",
    });
    expect(uuCalls("/api/v2/room/share/cancel_remote_assist")).toHaveLength(0);

    await startCompatibleConnection(user);
    await waitFor(() => {
      expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(1);
    });
    expect(appBackend.requestLog.find((call) => call.path === "/api/remote/signal/start")?.body).toHaveProperty(
      "joinContext.targetPlatform",
      4,
    );
  });

  it("cancels remote assistance before signaling when the joined device platform is missing", async () => {
    vi.stubGlobal("RTCPeerConnection", TestPeerConnection);
    appBackend.currentParticipants = [];
    appBackend.currentAssistPlatformFields = {};
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "我的设备" });
    await user.click(screen.getByRole("link", { name: /远控伙伴/ }));
    await screen.findByRole("heading", { name: "远控伙伴" });
    await user.type(screen.getByLabelText("伙伴的设备 ID"), "982123456");
    await user.type(screen.getByLabelText(/设备验证码/), "L6026CCD");
    await user.click(screen.getByRole("button", { name: "发起连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("伙伴设备未返回设备系统，已取消本次远程协助");
    expect(uuCalls("/api/v2/room/share/cancel_remote_assist")).toHaveLength(1);
    expect(appBackend.requestLog.filter((call) => call.path === "/api/remote/signal/start")).toHaveLength(0);
    expect(window.sessionStorage.getItem("uurc.latestRoomSession")).toBeNull();
  });
});
