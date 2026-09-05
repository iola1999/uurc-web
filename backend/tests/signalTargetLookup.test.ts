import { lookup } from "node:dns";
import { expect, it, vi } from "vitest";
import { SocketIoSignalGatewayConnector } from "../src/services/socketIoSignalGatewayConnector.js";

vi.mock("node:dns", () => ({
  lookup: vi.fn((_hostname, _options, callback) => callback(null, [{ address: "127.0.0.1", family: 4 }])),
}));

it("applies DNS filtering through the actual Socket.IO WebSocket HTTPS agent", async () => {
  const connector = new SocketIoSignalGatewayConnector();
  await expect(
    connector.connect({
      signalServer: "wss://signal.example",
      signalServers: ["wss://signal.example"],
      headers: {},
      inboundEvents: [],
      socketEvents: {
        control: "control",
        leave: "leave",
        bmsgPush: "bmsg_push",
        publisherDisconnect: "publisher_disconnect",
      },
      controlEvent: "control",
      onSignalEvent: () => {},
      timeoutMs: 1000,
    }),
  ).rejects.toThrow();
  expect(lookup).toHaveBeenCalledWith("signal.example", expect.objectContaining({ all: true }), expect.any(Function));
});
