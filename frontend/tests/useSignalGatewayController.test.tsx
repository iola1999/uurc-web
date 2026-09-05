import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSignalGatewayController } from "../src/controllers/useSignalGatewayController.js";

afterEach(() => vi.unstubAllGlobals());

it("ignores a delayed event response after reset", async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn((path) =>
      String(path).includes("/events")
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(Response.json({ gatewayStatus: "connected" })),
    ),
  );
  const { result } = renderHook(() =>
    useSignalGatewayController({
      browserStage: "idle",
      browserSessionRef: { current: null },
      onPollingError: vi.fn(),
      onSessionStateChange: vi.fn(),
    }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.refreshSignalEvents();
  });
  act(() => result.current.resetSignalEvents());
  await act(async () => {
    release(Response.json([{ id: 100, event: "old", payload: [] }]));
    await pending;
  });
  expect(result.current.signalEvents).toEqual([]);
  expect(result.current.remoteSignalDiagnostics).toBeNull();
});
