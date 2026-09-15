import { describe, expect, it } from "vitest";

import {
  buildBrowserEngineIoWebSocketUrl,
  buildEngineIoWebSocketUrl,
  deconstructBinary,
  encodeSocketIoPacket,
  parseSocketIoPacket,
  prefixEngineIoBinaryFrame,
  reconstructBinaryPlaceholders,
  stripEngineIoBinaryFramePrefix,
} from "../src/signalGateway/socketIoWire.js";

describe("Socket.IO wire codec", () => {
  it("builds an Engine.IO websocket endpoint while preserving existing query parameters", () => {
    expect(buildEngineIoWebSocketUrl("wss://signal.example?token=one")).toBe(
      "https://signal.example/socket.io/?token=one&EIO=4&transport=websocket",
    );
    expect(buildEngineIoWebSocketUrl("https://signal.example/custom")).toBe(
      "https://signal.example/custom/?EIO=4&transport=websocket",
    );
  });

  it("builds a browser Engine.IO websocket endpoint that keeps the wss scheme", () => {
    expect(buildBrowserEngineIoWebSocketUrl("wss://signal.example?token=one")).toBe(
      "wss://signal.example/socket.io/?token=one&EIO=4&transport=websocket",
    );
    expect(buildBrowserEngineIoWebSocketUrl("https://signal.example/custom")).toBe(
      "wss://signal.example/custom/?EIO=4&transport=websocket",
    );
    expect(() => buildBrowserEngineIoWebSocketUrl("wss://127.0.0.1")).toThrow();
  });

  it("round-trips namespace, binary attachment count and ack id", () => {
    const encoded = encodeSocketIoPacket({
      type: 5,
      namespace: "/remote",
      attachments: 2,
      id: 17,
      data: ["soac", { value: true }],
    });

    expect(encoded).toBe('52-/remote,17["soac",{"value":true}]');
    expect(parseSocketIoPacket(encoded)).toEqual({
      type: 5,
      namespace: "/remote",
      attachments: 2,
      id: 17,
      data: ["soac", { value: true }],
    });
  });

  it("deconstructs nested binary values and restores their placeholders", () => {
    const first = new Uint8Array([1, 2]);
    const second = new Uint8Array([3, 4]);
    const deconstructed = deconstructBinary({ first, nested: [second] });

    expect(deconstructed.data).toEqual({
      first: { _placeholder: true, num: 0 },
      nested: [{ _placeholder: true, num: 1 }],
    });
    expect(reconstructBinaryPlaceholders(deconstructed.data, deconstructed.buffers)).toEqual({
      first,
      nested: [second],
    });
  });

  it("adds a transport prefix to every raw binary payload and strips one received prefix", () => {
    const payload = new Uint8Array([8, 1]);
    const prefixed = prefixEngineIoBinaryFrame(payload);

    expect(prefixed).toEqual(new Uint8Array([4, 8, 1]));
    expect(prefixEngineIoBinaryFrame(prefixed)).toEqual(new Uint8Array([4, 4, 8, 1]));
    expect(stripEngineIoBinaryFramePrefix(prefixed)).toEqual(payload);
    expect(stripEngineIoBinaryFramePrefix(payload)).toBe(payload);
  });
});
