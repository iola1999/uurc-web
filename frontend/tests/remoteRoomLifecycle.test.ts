import { expect, it, vi } from "vitest";
import { createRemoteRoomLifecycle } from "../src/controllers/remoteRoomLifecycle.js";
import { joinRoomByDevice, clearRoomByDevice } from "../src/uu/roomApi.js";
import { stopRemoteSignalGateway } from "../src/api/remoteSignalApi.js";

vi.mock("../src/uu/roomApi.js", () => ({
  joinRoomByDevice: vi.fn(),
  clearRoomByDevice: vi.fn(async () => ({ status: 200, body: { code: 0 } })),
  getRemoteBootstrap: vi.fn(() => ({})),
  getDeviceGroups: vi.fn(),
}));
vi.mock("../src/api/remoteSignalApi.js", () => ({
  stopRemoteSignalGateway: vi.fn(async () => ({ status: "closed" })),
  startRemoteSignalGateway: vi.fn(),
  getRemoteSignalDiagnostics: vi.fn(),
}));

it("finishes a late join and its cleanup before joining the next target", async () => {
  let resolveJoin!: (value: never) => void;
  const room = { roomConfigSummary: {} } as never;
  vi.mocked(joinRoomByDevice)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve;
        }),
    )
    .mockResolvedValue(room);
  let active = true;
  function lifecycle(deviceId: string, isActive = () => true) {
    return createRemoteRoomLifecycle({
      allDevices: [],
      authDeviceId: "synthetic-web",
      forceJoin: false,
      selectedDeviceId: deviceId,
      sdpTransportMode: "plain",
      signalServerIndex: 0,
      roomJoinContext: null,
      isActive,
      run: async (_action, task) => {
        await task();
        return true;
      },
      onDevicesChange: vi.fn(),
      onForceJoinChange: vi.fn(),
      resetBrowserRemoteSession: vi.fn(),
      resetSignalEvents: vi.fn(),
      resetSignalGateway: vi.fn(),
      setRemoteBootstrap: vi.fn(),
      setRemoteSignalDiagnostics: vi.fn(),
      setRoomJoinContext: vi.fn(),
      setRoomResponse: vi.fn(),
      setSignalGatewayContext: vi.fn(),
      setSignalGatewayStatus: vi.fn(),
      showToast: vi.fn(),
    });
  }
  const old = lifecycle("old", () => active).joinRoomForDevice("old");
  await vi.waitFor(() => expect(joinRoomByDevice).toHaveBeenCalledOnce());
  active = false;
  const next = lifecycle("next").joinRoomForDevice("next");
  await Promise.resolve();
  expect(joinRoomByDevice).toHaveBeenCalledOnce();
  resolveJoin(room);
  expect(await old).toBeNull();
  expect(await next).toMatchObject({ deviceId: "next" });
  expect(clearRoomByDevice).toHaveBeenCalledWith("old");
  expect(vi.mocked(stopRemoteSignalGateway).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(joinRoomByDevice).mock.invocationCallOrder[1],
  );
});
