// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, createEvent, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserRemoteSession } from "../src/remote/browserRemoteSession.js";
import { useRemoteInputController } from "../src/controllers/useRemoteInputController.js";
import type { RemoteVideoRotation } from "../src/remote/remoteVideoOrientation.js";

const clipboardMocks = vi.hoisted(() => ({
  accessIssue: vi.fn<() => string | null>(),
  read: vi.fn<() => Promise<string>>(),
}));

vi.mock("../src/browser/clipboard.js", () => ({
  getLocalClipboardAccessIssue: clipboardMocks.accessIssue,
  readLocalClipboardText: clipboardMocks.read,
}));

describe("useRemoteInputController", () => {
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;

  beforeEach(() => {
    clipboardMocks.accessIssue.mockReset();
    clipboardMocks.accessIssue.mockReturnValue(null);
    clipboardMocks.read.mockReset();
    clipboardMocks.read.mockResolvedValue("");
    frameCallbacks.clear();
    nextFrame = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frame = nextFrame++;
      frameCallbacks.set(frame, callback);
      return frame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
      frameCallbacks.delete(frame);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("coalesces ordinary moves and flushes the current point before a button event", async () => {
    const calls: Array<{ kind: string; input: unknown; critical?: boolean }> = [];
    const session = {
      sendMouseMove: vi.fn((input, options) => calls.push({ kind: "move", input, critical: options?.critical })),
      sendMouseButton: vi.fn((input) => calls.push({ kind: "button", input })),
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;

    const view = render(
      <Harness
        session={session}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));
    const stage = view.getByTestId("stage") as HTMLDivElement;
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    const video = stage.querySelector("video")!;
    Object.defineProperty(video, "videoWidth", { value: 1000, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 500, configurable: true });
    flushFrames();

    act(() => {
      controller?.handleRemoteStagePointerMove(pointerEvent(stage, 10, 20));
      controller?.handleRemoteStagePointerMove(pointerEvent(stage, 40, 50));
      controller?.handleRemoteStagePointerMove(pointerEvent(stage, 90, 100));
    });
    expect(calls).toEqual([]);

    flushFrames();
    expect(calls).toEqual([
      {
        kind: "move",
        critical: false,
        input: { absX: 90, absY: 100, surfaceWidth: 1000, surfaceHeight: 500 },
      },
    ]);

    act(() => {
      controller?.handleRemoteStagePointerMove(pointerEvent(stage, 120, 130));
      controller?.handleRemoteStagePointerDown(pointerEvent(stage, 200, 210));
    });
    expect(calls.slice(-2)).toEqual([
      {
        kind: "move",
        critical: true,
        input: { absX: 200, absY: 210, surfaceWidth: 1000, surfaceHeight: 500 },
      },
      { kind: "button", input: { action: "mousePress", button: "primary" } },
    ]);
    flushFrames();
    expect(calls).toHaveLength(3);
  });

  it("does not send a press when its critical position cannot be sent", async () => {
    const onError = vi.fn();
    const session = {
      sendMouseMove: vi.fn(() => {
        throw new Error("control channel is congested");
      }),
      sendMouseButton: vi.fn(),
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;

    const view = render(
      <Harness
        session={session}
        onError={onError}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));
    const stage = view.getByTestId("stage") as HTMLDivElement;
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    const video = stage.querySelector("video")!;
    Object.defineProperty(video, "videoWidth", { value: 1000, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 500, configurable: true });
    flushFrames();

    act(() => controller?.handleRemoteStagePointerDown(pointerEvent(stage, 200, 210)));

    expect(session.sendMouseMove).toHaveBeenCalledOnce();
    expect(session.sendMouseButton).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("control channel is congested");
  });

  it("forwards macOS Cmd+C as a held Command key and a complete C press", async () => {
    const sendKeyboardInput = vi.fn();
    const session = {
      sendKeyboardInput,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyC", key: "c", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });

    expect(sendKeyboardInput.mock.calls.map(([input]) => input)).toEqual([
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 31 },
      { action: "keyboardRelease", value: 31 },
      { action: "keyboardRelease", value: 117 },
    ]);
  });

  it("uses the remote clipboard after clicking a destination following macOS Cmd+C", async () => {
    const sendKeyboardInput = vi.fn();
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput,
      sendMouseButton: vi.fn(),
      sendMouseMove: vi.fn(),
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage") as HTMLDivElement;
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    const video = stage.querySelector("video")!;
    Object.defineProperty(video, "videoWidth", { value: 1000, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 500, configurable: true });
    flushFrames();

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyC", key: "c", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });
    fireEvent.pointerDown(stage, { button: 0, clientX: 400, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(stage, { button: 0, clientX: 400, clientY: 200, pointerId: 1 });
    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    const pasteKeyDown = createEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent(stage, pasteKeyDown);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const browserPaste = createEvent.paste(stage, {
      clipboardData: {
        getData: (type: string) => (type === "text" ? "stale local clipboard" : ""),
      },
    });
    fireEvent(stage, browserPaste);
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });

    expect(pasteKeyDown.defaultPrevented).toBe(true);
    expect(browserPaste.defaultPrevented).toBe(true);
    expect(clipboardMocks.read).not.toHaveBeenCalled();
    expect(sendPastedText).not.toHaveBeenCalled();
    expect(sendKeyboardInput.mock.calls.map(([input]) => input)).toEqual([
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 31 },
      { action: "keyboardRelease", value: 31 },
      { action: "keyboardRelease", value: 117 },
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 50 },
      { action: "keyboardRelease", value: 50 },
      { action: "keyboardRelease", value: 117 },
    ]);
  });

  it("keeps using the remote clipboard for repeated macOS Cmd+V shortcuts", () => {
    const sendKeyboardInput = vi.fn();
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput,
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyC", key: "c", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });
    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent.keyUp(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });

    expect(clipboardMocks.read).not.toHaveBeenCalled();
    expect(sendPastedText).not.toHaveBeenCalled();
    expect(sendKeyboardInput.mock.calls.map(([input]) => input)).toEqual([
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 31 },
      { action: "keyboardRelease", value: 31 },
      { action: "keyboardRelease", value: 117 },
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 50 },
      { action: "keyboardRelease", value: 50 },
      { action: "keyboardRelease", value: 117 },
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 50 },
      { action: "keyboardRelease", value: 50 },
      { action: "keyboardRelease", value: 117 },
    ]);
  });

  it("returns to the local clipboard path after the remote stage loses focus", async () => {
    clipboardMocks.read.mockResolvedValue("new local clipboard");
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput: vi.fn(),
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyC", key: "c", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });
    fireEvent.blur(stage);
    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });

    await waitFor(() => expect(sendPastedText).toHaveBeenCalledWith("new local clipboard"));
    expect(clipboardMocks.read).toHaveBeenCalledOnce();
  });

  it("uses the remote clipboard for macOS Cmd+V after a remote Cmd+X", () => {
    const sendKeyboardInput = vi.fn();
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput,
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyX", key: "x", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });
    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent.keyUp(stage, { code: "MetaLeft", key: "Meta" });

    expect(clipboardMocks.read).not.toHaveBeenCalled();
    expect(sendPastedText).not.toHaveBeenCalled();
    expect(sendKeyboardInput.mock.calls.map(([input]) => input)).toEqual([
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 52 },
      { action: "keyboardRelease", value: 52 },
      { action: "keyboardRelease", value: 117 },
      { action: "keyboardPress", value: 117 },
      { action: "keyboardPress", value: 50 },
      { action: "keyboardRelease", value: 50 },
      { action: "keyboardRelease", value: 117 },
    ]);
  });

  it("ignores a stale local clipboard read after the remote stage loses focus", async () => {
    let resolveClipboard: ((text: string) => void) | undefined;
    clipboardMocks.read.mockReturnValue(
      new Promise((resolve) => {
        resolveClipboard = resolve;
      }),
    );
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput: vi.fn(),
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent.blur(stage);
    await act(async () => resolveClipboard?.("stale local clipboard"));

    expect(sendPastedText).not.toHaveBeenCalled();
  });

  it("ignores a stale local clipboard read after a newer remote pointer action", async () => {
    let resolveClipboard: ((text: string) => void) | undefined;
    clipboardMocks.read.mockReturnValue(
      new Promise((resolve) => {
        resolveClipboard = resolve;
      }),
    );
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput: vi.fn(),
      sendMouseButton: vi.fn(),
      sendMouseMove: vi.fn(),
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    fireEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent.pointerDown(stage, { button: 0, clientX: 400, clientY: 200, pointerId: 1 });
    await act(async () => resolveClipboard?.("stale local clipboard"));

    expect(sendPastedText).not.toHaveBeenCalled();
  });

  it("reads the local clipboard for macOS Cmd+V and releases Command before sending text", async () => {
    clipboardMocks.read.mockResolvedValue("pasted from system clipboard");
    const sendKeyboardInput = vi.fn();
    const sendPastedText = vi.fn();
    const state = { stage: "connected" } as ReturnType<BrowserRemoteSession["getState"]>;
    const onSessionStateChange = vi.fn();
    const session = {
      getState: vi.fn(() => state),
      sendKeyboardInput,
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(
      <Harness
        session={session}
        onController={() => undefined}
        onSessionStateChange={onSessionStateChange}
        targetPlatform={4}
      />,
    );
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    const pasteKeyDown = createEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent(stage, pasteKeyDown);

    expect(pasteKeyDown.defaultPrevented).toBe(true);
    expect(clipboardMocks.read).toHaveBeenCalledOnce();
    await waitFor(() => expect(sendPastedText).toHaveBeenCalledWith("pasted from system clipboard"));
    expect(sendKeyboardInput.mock.calls.map(([input]) => input)).toEqual([
      { action: "keyboardPress", value: 117 },
      { action: "keyboardRelease", value: 117 },
    ]);
    expect(onSessionStateChange).toHaveBeenCalledWith(state);
  });

  it("reports a modifier release failure before reading the local clipboard", () => {
    const onError = vi.fn();
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput: vi.fn((input: { action: string }) => {
        if (input.action === "keyboardRelease") throw new Error("control channel closed");
      }),
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(
      <Harness session={session} onController={() => undefined} onError={onError} targetPlatform={4} />,
    );
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    const pasteKeyDown = createEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent(stage, pasteKeyDown);

    expect(pasteKeyDown.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledWith("control channel closed");
    expect(clipboardMocks.read).not.toHaveBeenCalled();
    expect(sendPastedText).not.toHaveBeenCalled();
  });

  it("falls back to the browser paste event when direct clipboard reading is unavailable", () => {
    clipboardMocks.accessIssue.mockReturnValue("clipboard read is unavailable");
    const sendKeyboardInput = vi.fn();
    const sendPastedText = vi.fn();
    const session = {
      getState: vi.fn(() => ({ stage: "connected" })),
      sendKeyboardInput,
      sendPastedText,
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    const view = render(<Harness session={session} onController={() => undefined} targetPlatform={4} />);
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "MetaLeft", key: "Meta", metaKey: true });
    const pasteKeyDown = createEvent.keyDown(stage, { code: "KeyV", key: "v", metaKey: true });
    fireEvent(stage, pasteKeyDown);
    fireEvent.paste(stage, {
      clipboardData: {
        getData: (type: string) => (type === "text" ? "pasted from browser" : ""),
      },
    });

    expect(pasteKeyDown.defaultPrevented).toBe(false);
    expect(clipboardMocks.read).not.toHaveBeenCalled();
    expect(sendKeyboardInput.mock.calls.map(([input]) => input)).toEqual([
      { action: "keyboardPress", value: 117 },
      { action: "keyboardRelease", value: 117 },
    ]);
    expect(sendPastedText).toHaveBeenCalledWith("pasted from browser");
  });

  it("releases held keys when the control channel drops and flushes them again when it reopens", async () => {
    const releaseAllInputs = vi.fn();
    const session = { sendKeyboardInput: vi.fn(), releaseAllInputs } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;
    const onController = (nextController: ReturnType<typeof useRemoteInputController>) => {
      controller = nextController;
    };

    const view = render(<Harness session={session} controlChannelState="open" onController={onController} />);
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));

    releaseAllInputs.mockClear();
    view.rerender(<Harness session={session} controlChannelState="connecting" onController={onController} />);
    await waitFor(() => expect(controller?.inputControlActive).toBe(false));
    expect(releaseAllInputs).toHaveBeenCalled();

    releaseAllInputs.mockClear();
    view.rerender(<Harness session={session} controlChannelState="open" onController={onController} />);
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));
    expect(releaseAllInputs).toHaveBeenCalled();
  });

  it("releases held keys when input control is turned off for view-only mode", async () => {
    const releaseAllInputs = vi.fn();
    const session = { sendKeyboardInput: vi.fn(), releaseAllInputs } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;

    render(
      <Harness
        session={session}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));

    releaseAllInputs.mockClear();
    act(() => controller?.resetInputControl());

    expect(releaseAllInputs).toHaveBeenCalledOnce();
    expect(controller?.inputControlActive).toBe(false);
  });

  it("reconciles held modifiers against the browser state on every key press", async () => {
    const releaseOrphanModifiers = vi.fn();
    const session = {
      sendKeyboardInput: vi.fn(),
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers,
    } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;

    const view = render(
      <Harness
        session={session}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));
    const stage = view.getByTestId("stage");

    fireEvent.keyDown(stage, { code: "KeyA", key: "a", ctrlKey: true });
    const heldWhilePressed = releaseOrphanModifiers.mock.calls.at(-1)![0] as (family: string) => boolean;
    expect(heldWhilePressed("Control")).toBe(true);
    expect(heldWhilePressed("Shift")).toBe(false);

    fireEvent.keyDown(stage, { code: "KeyB", key: "b" });
    const heldAfterSwallowedKeyUp = releaseOrphanModifiers.mock.calls.at(-1)![0] as (family: string) => boolean;
    expect(heldAfterSwallowedKeyUp("Control")).toBe(false);
  });

  it("reconciles held modifiers on pointer down so a mouse-only session can recover too", async () => {
    const releaseOrphanModifiers = vi.fn();
    const session = {
      sendMouseMove: vi.fn(),
      sendMouseButton: vi.fn(),
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers,
    } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;

    const view = render(
      <Harness
        session={session}
        onController={(nextController) => {
          controller = nextController;
        }}
      />,
    );
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));
    const stage = view.getByTestId("stage") as HTMLDivElement;
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    const video = stage.querySelector("video")!;
    Object.defineProperty(video, "videoWidth", { value: 1000, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 500, configurable: true });

    act(() => controller?.handleRemoteStagePointerDown(pointerEvent(stage, 10, 20)));

    expect(releaseOrphanModifiers).toHaveBeenCalledOnce();
  });

  // 画面摆正之后，屏幕上的位置就是被控端桌面上的位置，指针坐标不按旋转角度做换算。
  // 只有 90°/270° 会换掉画面在屏幕上的长宽，内容框跟着换，坐标仍然是在内容框里直接归一化。
  it("sends the point under the cursor whatever the picture is turned by", async () => {
    const moves: unknown[] = [];
    const session = {
      sendMouseMove: vi.fn((input) => moves.push(input)),
      sendMouseButton: vi.fn(),
      releaseAllInputs: vi.fn(),
      releaseOrphanModifiers: vi.fn(),
    } as unknown as BrowserRemoteSession;
    let controller: ReturnType<typeof useRemoteInputController> | undefined;
    const onController = (nextController: ReturnType<typeof useRemoteInputController>) => {
      controller = nextController;
    };

    const view = render(<Harness session={session} videoRotation={180} onController={onController} />);
    await waitFor(() => expect(controller?.inputControlActive).toBe(true));
    const stage = view.getByTestId("stage") as HTMLDivElement;
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
    const video = stage.querySelector("video")!;
    Object.defineProperty(video, "videoWidth", { value: 1000, configurable: true });
    Object.defineProperty(video, "videoHeight", { value: 500, configurable: true });
    flushFrames();

    act(() => controller?.handleRemoteStagePointerMove(pointerEvent(stage, 100, 50)));
    flushFrames();
    expect(moves.at(-1)).toEqual({ absX: 100, absY: 50, surfaceWidth: 1000, surfaceHeight: 500 });

    // 转 90° 后画面在屏幕上是 250x500 的一竖条，居中摆放：点它的左上角就是被控端桌面的原点。
    view.rerender(<Harness session={session} videoRotation={90} onController={onController} />);
    flushFrames();
    act(() => controller?.handleRemoteStagePointerMove(pointerEvent(stage, 375, 0)));
    flushFrames();
    expect(moves.at(-1)).toEqual({ absX: 0, absY: 0, surfaceWidth: 500, surfaceHeight: 1000 });

    act(() => controller?.handleRemoteStagePointerMove(pointerEvent(stage, 500, 250)));
    flushFrames();
    expect(moves.at(-1)).toEqual({ absX: 250, absY: 500, surfaceWidth: 500, surfaceHeight: 1000 });
  });

  function flushFrames(): void {
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    act(() => callbacks.forEach((callback) => callback(performance.now())));
  }
});

function Harness({
  session,
  onError = (message) => {
    throw new Error(message);
  },
  onController,
  onSessionStateChange = () => undefined,
  targetPlatform = 1,
  controlChannelState = "open",
  videoRotation = 0,
}: {
  session: BrowserRemoteSession;
  onError?: (message: string) => void;
  onController(controller: ReturnType<typeof useRemoteInputController>): void;
  onSessionStateChange?: (state: ReturnType<BrowserRemoteSession["getState"]>) => void;
  targetPlatform?: number;
  controlChannelState?: RTCDataChannelState;
  videoRotation?: RemoteVideoRotation;
}) {
  const browserSessionRef = { current: session };
  const controller = useRemoteInputController({
    browserSessionRef,
    controlChannelState,
    targetPlatform,
    primaryRemoteVideoId: "video-1",
    remoteStageViewMode: "fit",
    videoRotation,
    onError,
    onSessionStateChange,
  });
  useEffect(() => onController(controller), [controller, onController]);
  return (
    <div
      ref={controller.remoteStageRef}
      data-testid="stage"
      tabIndex={0}
      onKeyDown={controller.handleRemoteStageKeyDown}
      onKeyUp={controller.handleRemoteStageKeyUp}
      onBlur={controller.handleRemoteStageBlur}
      onPaste={controller.handleRemoteStagePaste}
      onPointerDown={controller.handleRemoteStagePointerDown}
      onPointerUp={controller.handleRemoteStagePointerUp}
    >
      <video data-active="true" />
      <div data-remote-cursor-overlay data-visible="false" />
    </div>
  );
}

function pointerEvent(stage: HTMLDivElement, clientX: number, clientY: number) {
  return {
    button: 0,
    clientX,
    clientY,
    currentTarget: stage,
    pointerId: 1,
    preventDefault: vi.fn(),
    nativeEvent: { getModifierState: () => false },
  } as unknown as Parameters<ReturnType<typeof useRemoteInputController>["handleRemoteStagePointerMove"]>[0];
}
