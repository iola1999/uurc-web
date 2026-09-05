import { expect, it } from "vitest";
import { workerSignalGatewayBinary } from "../src/signal/workerSignalBinaryCodec.js";
import { SIGNAL_MAX_SDP_BYTES } from "@uurc/shared/signalGateway/status";

it("rejects gzip SDP expansion beyond the output limit", async () => {
  const oversized = await workerSignalGatewayBinary.gzipText("x".repeat(SIGNAL_MAX_SDP_BYTES + 1));
  expect(await workerSignalGatewayBinary.gunzipText(oversized)).toBeNull();
  expect(await workerSignalGatewayBinary.gunzipText(await workerSignalGatewayBinary.gzipText("v=0\n"))).toBe("v=0\n");
});
