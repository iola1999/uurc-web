import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRemoteRecoveryController } from "../src/controllers/useRemoteRecoveryController.js";
import type {
  BrowserRemoteSessionState,
  BrowserRemoteVideoFlowDiagnostics,
} from "../src/remote/browserRemoteSessionTypes.js";

describe("useRemoteRecoveryController", () => {
  it("reconnects a disconnected gateway and preserves attempts through idle and offered stages", async () => {
    vi.useFakeTimers();
    try {
      const reconnect = vi.fn(async () => {});
      const { result, rerender } = renderHook(
        ({
          stage,
          busy,
          joined,
        }: {
          stage: BrowserRemoteSessionState["stage"];
          busy: "reconnect" | null;
          joined: boolean;
        }) =>
          useRemoteRecoveryController({
            autoReconnectEnabled: true,
            browserRemoteState: { ...createState({ status: "transport_stalled", updatedAtMs: 1000 }), stage },
            busy,
            controlChannelState: "closed",
            roomJoinedForSelectedDevice: joined,
            signalGatewayMatchesRoom: false,
            onReconnect: reconnect,
          }),
        {
          initialProps: {
            stage: "connected" as BrowserRemoteSessionState["stage"],
            busy: null as "reconnect" | null,
            joined: true,
          },
        },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      rerender({ stage: "idle", busy: "reconnect", joined: true });
      expect(result.current.autoReconnectAttemptCount).toBe(1);
      rerender({ stage: "offered", busy: null, joined: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(reconnect).toHaveBeenCalledTimes(1);
      rerender({ stage: "connected", busy: null, joined: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800);
      });
      expect(reconnect.mock.calls.map((args) => args[0])).toEqual([0, 1]);
      rerender({ stage: "idle", busy: null, joined: false });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(reconnect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["decode_stalled", "presentation_stalled"] as const)(
    "treats two consecutive %s samples as recoverable",
    (status) => {
      const { result, rerender } = renderHook(
        ({ browserRemoteState }) =>
          useRemoteRecoveryController({
            autoReconnectEnabled: false,
            browserRemoteState,
            busy: null,
            controlChannelState: "open",
            roomJoinedForSelectedDevice: true,
            signalGatewayMatchesRoom: true,
            onReconnect: vi.fn(),
          }),
        {
          initialProps: {
            browserRemoteState: createState({
              status: "receiving",
              updatedAtMs: 1_000,
            }),
          },
        },
      );

      rerender({
        browserRemoteState: createState({
          status,
          updatedAtMs: 2_000,
        }),
      });
      expect(result.current.decodeStalledStreak).toBe(1);
      expect(result.current.browserConnectionRecoverable).toBe(false);

      rerender({
        browserRemoteState: createState({
          status,
          updatedAtMs: 3_000,
        }),
      });
      expect(result.current.decodeStalledStreak).toBe(2);
      expect(result.current.browserConnectionRecoverable).toBe(true);
    },
  );

  it("backs off once three triggers land inside twenty seconds", async () => {
    vi.useFakeTimers();
    try {
      const reconnect = vi.fn(async () => {});
      const { result } = renderHook(() =>
        useRemoteRecoveryController({
          autoReconnectEnabled: true,
          browserRemoteState: createState({ status: "transport_stalled", updatedAtMs: 1000 }),
          busy: null,
          controlChannelState: "closed",
          roomJoinedForSelectedDevice: true,
          signalGatewayMatchesRoom: false,
          onReconnect: reconnect,
        }),
      );

      // 前三次按常规间隔触发：0.9s、1.8s、3.6s，三次落在 20 秒窗口内。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3600);
      });
      expect(reconnect).toHaveBeenCalledTimes(3);

      // 第四次进入退避：再过 9 秒仍未触发，到 20 秒才触发。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(reconnect).toHaveBeenCalledTimes(3);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      expect(reconnect).toHaveBeenCalledTimes(4);
      expect(result.current.autoReconnectAttemptCount).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops auto reconnect after ten consecutive attempts and keeps the manual path", async () => {
    vi.useFakeTimers();
    try {
      const reconnect = vi.fn(async () => {});
      const { result } = renderHook(() =>
        useRemoteRecoveryController({
          autoReconnectEnabled: true,
          browserRemoteState: createState({ status: "transport_stalled", updatedAtMs: 1000 }),
          busy: null,
          controlChannelState: "closed",
          roomJoinedForSelectedDevice: true,
          signalGatewayMatchesRoom: false,
          onReconnect: reconnect,
        }),
      );

      // 退避间隔最长 60 秒，逐段推进足够覆盖十次尝试。
      for (let step = 0; step < 20; step += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
      }

      expect(reconnect).toHaveBeenCalledTimes(10);
      expect(result.current.autoReconnectStopped).toBe(true);
      expect(result.current.autoReconnectStatus).toContain("停止自动重试");
      expect(result.current.browserConnectionRecoverable).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createState(
  videoFlow: Pick<BrowserRemoteVideoFlowDiagnostics, "status" | "updatedAtMs">,
): BrowserRemoteSessionState {
  return {
    appControlId: "test-app-control",
    connectionPath: "direct",
    dataChannels: {},
    debugEvents: [],
    remoteTrackCount: 1,
    stage: "connected",
    videoFlow: {
      ...videoFlow,
      title: videoFlow.status,
      detail: videoFlow.status,
    },
  };
}
