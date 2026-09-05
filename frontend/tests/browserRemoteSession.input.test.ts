import { describe, expect, it } from "vitest";

import { encodeStreamerInputMessage, encodeStreamerTextMessage } from "@uurc/shared/streamer/controlChannelEncode";
import {
  buildStreamerKeyboardInputMessage,
  buildStreamerMacKeyboardInputMessage,
  buildStreamerMacMouseMoveAbsoluteInputMessage,
  buildStreamerMacMouseScrollInputMessage,
  buildStreamerMouseButtonInputMessage,
  buildStreamerTextInputMessage,
  buildStreamerWindowsKeyboardInputMessage,
} from "@uurc/shared/streamer/inputDesktop";
import { STREAMER_DATA_CHANNEL_LABELS } from "@uurc/shared/streamer/transport";
import { BrowserRemoteSession } from "../src/remote/browserRemoteSession.js";
import { FakePeerConnection, FakeRemoteApi } from "./browserRemoteSessionTestHarness.js";

describe("BrowserRemoteSession", () => {
  it("transforms browser input through the Mac server keymap shape for Mac targets", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 2600,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      targetPlatform: 4,
    });

    session.sendMouseMove({ absX: 384, absY: 1037, surfaceWidth: 1920, surfaceHeight: 1080 });
    session.sendKeyboardInput({ action: "keyboardPress", value: 59 });
    session.sendMouseScroll({ deltaX: 0, deltaY: -120 });

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      buildStreamerMacMouseMoveAbsoluteInputMessage({
        absX: 384,
        absY: 1037,
        surfaceWidth: 1920,
        surfaceHeight: 1080,
      }),
      buildStreamerMacKeyboardInputMessage({ action: "keyboardPress", value: 59 }),
      buildStreamerMacMouseScrollInputMessage({ deltaX: 0, deltaY: -120 }),
    ]);
  });

  it("transforms browser input through the Windows server keymap shape for Windows targets", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 2600,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      targetPlatform: 1,
    });

    session.sendMouseMove({ absX: 384, absY: 1037, surfaceWidth: 1920, surfaceHeight: 1080 });
    session.sendKeyboardInput({ action: "keyboardPress", value: 113 });
    session.sendTextInput("o");
    session.sendMouseScroll({ deltaX: 0, deltaY: -120 });

    // Windows 是桌面被控端:与 Mac 一样走「裸 JSON(非 protobuf)+ 归一化坐标」，键码换成 Windows VK；
    // 打字走 text_input(单字符上屏)。
    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      buildStreamerMacMouseMoveAbsoluteInputMessage({
        absX: 384,
        absY: 1037,
        surfaceWidth: 1920,
        surfaceHeight: 1080,
      }),
      buildStreamerWindowsKeyboardInputMessage({ action: "keyboardPress", value: 113 }),
      buildStreamerTextInputMessage("o"),
      buildStreamerMacMouseScrollInputMessage({ deltaX: 0, deltaY: -120 }),
    ]);
  });

  it("releases macOS Command before sending pasted text on the control channel", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: () => peer,
      now: () => 2600,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      targetPlatform: 4,
    });

    session.sendKeyboardInput({ action: "keyboardPress", value: 117 });
    session.sendKeyboardInput({ action: "keyboardRelease", value: 117 });
    session.sendPastedText("  Mac paste  ");

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      '{"action":"kbd_press","key":55}',
      '{"action":"kbd_release","key":55}',
      buildStreamerTextInputMessage("  Mac paste  "),
    ]);
    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.text)?.sent).toEqual([]);
  });

  it("keeps pasted text for a mobile target on the App text channel", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: () => peer,
      now: () => 2600,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    session.sendPastedText("  mobile paste  ");

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([]);
    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.text)?.sent).toEqual([
      encodeStreamerTextMessage({
        sequence: 1,
        timestampMs: 2,
        inputMessage: "  mobile paste  ",
      }),
    ]);
  });

  it("sends desktop keyboard input on the App control channel", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 3000,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    session.sendKeyboardInput({ action: "keyboardPress", value: "A" });
    session.sendKeyboardInput({ action: "keyboardRelease", value: "A" });

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      encodeStreamerInputMessage({
        sequence: 1,
        timestampMs: 3,
        inputMessage: buildStreamerKeyboardInputMessage({ action: "keyboardPress", value: "A" }),
      }),
      encodeStreamerInputMessage({
        sequence: 2,
        timestampMs: 3,
        inputMessage: buildStreamerKeyboardInputMessage({ action: "keyboardRelease", value: "A" }),
      }),
    ]);
  });

  it("uses app-compatible second timestamps for control input messages", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 1_778_857_057_890,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    session.sendKeyboardInput({ action: "keyboardPress", value: "F12" });

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      encodeStreamerInputMessage({
        sequence: 1,
        timestampMs: 1_778_857_057,
        inputMessage: buildStreamerKeyboardInputMessage({ action: "keyboardPress", value: "F12" }),
      }),
    ]);
  });

  it("uses device_capability display ids for desktop SendToRom input messages", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 3200,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    await session.applySignalEvents([
      {
        id: 20,
        direction: "inbound",
        event: "forward_setting",
        receivedAt: "2026-05-15T00:00:02.000Z",
        payload: [
          {
            client_id: "controlled-1",
            data: {
              type: "device_capability",
              device_capability: {
                display_info: [{ id: 1, fps: 75, type: 0, hdr: -1 }],
              },
            },
          },
        ],
      },
    ]);
    session.sendKeyboardInput({ action: "keyboardPress", value: "A" });

    expect(session.getState().remoteDisplayId).toBe(1);
    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      encodeStreamerInputMessage({
        sequence: 1,
        timestampMs: 3,
        inputMessage: buildStreamerKeyboardInputMessage({ action: "keyboardPress", value: "A" }),
        displayId: 1,
      }),
    ]);
    expect(session.getState().debugEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "signal",
          summary: "记录受控端显示器",
          details: {
            displayId: 1,
          },
        }),
        expect.objectContaining({
          kind: "data_send",
          summary: "发送控制输入",
          details: expect.objectContaining({
            remoteDisplayId: 1,
          }),
        }),
      ]),
    );
  });

  it("uses the Mac keymap raw control-string route", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 3300,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      targetPlatform: 4,
    });

    await session.applySignalEvents([
      {
        id: 21,
        direction: "inbound",
        event: "device_capability",
        receivedAt: "2026-05-15T00:00:03.000Z",
        payload: {
          client_id: "controlled-1",
          data: {
            type: "device_capability",
            device_capability: {
              display_info: [{ id: 1, fps: 75, type: 0, hdr: -1 }],
            },
          },
        },
      },
    ]);
    session.sendKeyboardInput({ action: "keyboardPress", value: 29 });

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      buildStreamerMacKeyboardInputMessage({ action: "keyboardPress", value: 29 }),
    ]);
  });

  it("sends macOS Cmd+C with native Command and C key codes", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: () => peer,
      now: () => 3300,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
      targetPlatform: 4,
    });

    session.sendKeyboardInput({ action: "keyboardPress", value: 117 });
    session.sendKeyboardInput({ action: "keyboardPress", value: 31 });
    session.sendKeyboardInput({ action: "keyboardRelease", value: 31 });
    session.sendKeyboardInput({ action: "keyboardRelease", value: 117 });

    expect(peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)?.sent).toEqual([
      '{"action":"kbd_press","key":55}',
      '{"action":"kbd_press","key":8}',
      '{"action":"kbd_release","key":8}',
      '{"action":"kbd_release","key":55}',
    ]);
  });

  it("uses the MuMu capture_change id as the SendToRom input index", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 3250,
    });
    await session.start({
      appControlId: "control-1",
      appDataBase64: "Cg==",
      streamerData: "{}",
    });

    const control = peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control);
    control?.emitMessage(new Uint8Array([0x08, 0x01, 0x10, 0x02, 0x42, 0x04, 0x08, 2, 0x10, 0x05]).buffer);
    session.sendMouseButton({ action: "mousePress", button: "primary" });

    expect(session.getState().remoteInputDisplayId).toBe(5);
    expect(control?.sent).toEqual([
      encodeStreamerInputMessage({
        sequence: 1,
        timestampMs: 3,
        inputMessage: buildStreamerMouseButtonInputMessage({ action: "mousePress", button: "primary" }),
        displayId: 5,
      }),
    ]);
  });

  it("releases all held mouse buttons and keys via releaseAllInputs", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: (configuration) => {
        peer.configuration = configuration;
        return peer;
      },
      now: () => 9000,
    });
    await session.start({ appControlId: "control-1", appDataBase64: "Cg==", streamerData: "{}" });

    const control = peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control);
    session.sendMouseButton({ action: "mousePress", button: "secondary" });
    session.sendKeyboardInput({ action: "keyboardPress", value: "A" });
    control!.sent.length = 0;

    session.releaseAllInputs();

    expect(control?.sent).toEqual([
      encodeStreamerInputMessage({
        sequence: 3,
        timestampMs: 9,
        inputMessage: buildStreamerMouseButtonInputMessage({ action: "mouseRelease", button: "secondary" }),
      }),
      encodeStreamerInputMessage({
        sequence: 4,
        timestampMs: 9,
        inputMessage: buildStreamerKeyboardInputMessage({ action: "keyboardRelease", value: "A" }),
      }),
    ]);

    control!.sent.length = 0;
    session.releaseAllInputs();
    expect(control?.sent).toEqual([]);
  });

  it("retries held mouse and keyboard releases after a channel send failure", async () => {
    const api = new FakeRemoteApi();
    const peer = new FakePeerConnection();
    const session = new BrowserRemoteSession({
      api,
      createPeerConnection: () => peer,
      now: () => 9000,
    });
    await session.start({ appControlId: "control-1", appDataBase64: "Cg==", streamerData: "{}" });
    const control = peer.channels.get(STREAMER_DATA_CHANNEL_LABELS.control)!;
    session.sendMouseButton({ action: "mousePress", button: "secondary" });
    session.sendKeyboardInput({ action: "keyboardPress", value: "A" });
    control.sent.length = 0;
    control.failNextSendCount = 2;

    session.releaseAllInputs();
    expect(control.sent).toEqual([]);

    session.releaseAllInputs();
    expect(control.sent).toEqual([
      encodeStreamerInputMessage({
        sequence: 5,
        timestampMs: 9,
        inputMessage: buildStreamerMouseButtonInputMessage({ action: "mouseRelease", button: "secondary" }),
      }),
      encodeStreamerInputMessage({
        sequence: 6,
        timestampMs: 9,
        inputMessage: buildStreamerKeyboardInputMessage({ action: "keyboardRelease", value: "A" }),
      }),
    ]);

    control.sent.length = 0;
    session.releaseAllInputs();
    expect(control.sent).toEqual([]);
  });
});
