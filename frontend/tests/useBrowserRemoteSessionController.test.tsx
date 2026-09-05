import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useBrowserRemoteSessionController } from "../src/controllers/useBrowserRemoteSessionController.js";
import { BrowserRemoteSession } from "../src/remote/browserRemoteSession.js";
import { FakePeerConnection, FakeRemoteApi } from "./browserRemoteSessionTestHarness.js";

it("closes negotiation after the answer deadline and cancels the timer on reset", async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(useBrowserRemoteSessionController);
  const peer = new FakePeerConnection();
  const session = new BrowserRemoteSession({
    api: new FakeRemoteApi(),
    createPeerConnection: () => peer,
    onStateChange: (state) => result.current.setState(state),
  });
  try {
    await act(async () => {
      result.current.sessionRef.current = session;
      await session.start({ appControlId: "synthetic", appDataBase64: "Cg==", streamerData: "{}" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.state.stage).toBe("idle");
    expect(result.current.state.failureReason).toContain("超时");
    act(() => result.current.close());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.state.failureReason).toBeUndefined();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
