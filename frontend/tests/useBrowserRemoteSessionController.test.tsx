import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DEFAULT_FINGERPRINT_CONFIG } from "@uurc/shared/fingerprint";
import { useBrowserRemoteSessionController } from "../src/controllers/useBrowserRemoteSessionController.js";
import { BrowserRemoteSession } from "../src/remote/browserRemoteSession.js";
import { FakePeerConnection, FakeRemoteApi } from "./browserRemoteSessionTestHarness.js";

const mocks = vi.hoisted(() => ({
  controlRequests: [] as Array<{ appControlId: string; appDataBase64?: string; streamerData?: string }>,
}));

vi.mock("../src/api/remoteSignalApi.js", () => ({
  sendRemoteSignalControl: async (input: { appControlId: string; appDataBase64?: string; streamerData?: string }) => {
    mocks.controlRequests.push(input);
    return {
      event: "control",
      ackStatus: "success",
      ack: ["success", {}],
      control: {
        ackStatus: "success",
        result: { clientId: "controlled-1", iceId: "ice-1", iceServers: [] },
      },
      emittedAt: "2026-05-14T00:00:00.000Z",
      ackReceivedAt: "2026-05-14T00:00:00.000Z",
    };
  },
  sendRemoteSignalSoac: async () => ({ event: "soac", payload: [], emittedAt: "2026-05-14T00:00:00.000Z" }),
}));

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

it("applies the fingerprint client type and version to the connect options", async () => {
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  const { result, unmount } = renderHook(useBrowserRemoteSessionController);
  try {
    await act(async () => {
      await result.current.start({
        deviceId: "web-device-1",
        fingerprint: { ...DEFAULT_FINGERPRINT_CONFIG, clientType: 3, appVersionName: "9.9.9" },
        forceRelay: undefined,
        gzipSdp: true,
        remoteAssistance: false,
        targetPlatform: 3,
        onRemoteClipboard: () => undefined,
        onRemoteCursorShape: () => undefined,
        onRemoteStream: () => undefined,
      });
    });
    const appDataBase64 = mocks.controlRequests.at(-1)?.appDataBase64;
    expect(appDataBase64).toBeTruthy();
    const bytes = Uint8Array.from(atob(appDataBase64 ?? ""), (char) => char.charCodeAt(0));
    // client_type 是 tag 8 varint(0x40),默认参数下该字节唯一
    const clientTypeIndex = bytes.indexOf(0x40);
    expect(clientTypeIndex).toBeGreaterThan(0);
    expect(bytes[clientTypeIndex + 1]).toBe(3);
    expect(findSubarray(bytes, [...new TextEncoder().encode("9.9.9")])).toBeGreaterThan(0);
    act(() => result.current.close());
  } finally {
    unmount();
    vi.unstubAllGlobals();
  }
});

function findSubarray(haystack: Uint8Array, needle: number[]): number {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}
