import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { nodeSignalGatewayBinary } from "../src/services/nodeSignalGatewayBinaryCodec.js";
import { SIGNAL_MAX_SDP_BYTES } from "@uurc/shared/signalGateway/status";
import { SIGNAL_MAX_EVENT_BYTES } from "@uurc/shared/signalGateway/status";
import { RemoteControlService } from "../src/services/remoteControlService.js";
import { createRoomConfigSource, FakeSignalGatewayConnector } from "./fixtures/signalGateway.js";

it("rejects gzip SDP expansion beyond the output limit", () => {
  const oversized = gzipSync(Buffer.alloc(SIGNAL_MAX_SDP_BYTES + 1, 65));
  expect(nodeSignalGatewayBinary.gunzipText(oversized)).toBeNull();
  expect(nodeSignalGatewayBinary.gunzipText(gzipSync(Buffer.from("v=0\n")))).toBe("v=0\n");
});

it("retains a bounded event history by bytes", async () => {
  const connector = new FakeSignalGatewayConnector();
  const service = new RemoteControlService(createRoomConfigSource(), connector);
  await service.startSignalGateway();
  for (let i = 0; i < 20; i += 1) connector.connectCalls[0].onSignalEvent("synthetic", ["x".repeat(128 * 1024)]);
  const events = service.getSignalGatewayEvents();
  expect(events.length).toBeLessThan(20);
  expect(events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0)).toBeLessThanOrEqual(
    SIGNAL_MAX_EVENT_BYTES,
  );
  await service.stopSignalGateway();
});
