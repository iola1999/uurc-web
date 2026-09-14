import { describe, expect, it } from "vitest";

import {
  ValidationError,
  parseOptionalEventId,
  parseSignalControlRequest,
  parseSignalGatewayStartRequest,
  parseSignalSoacRequest,
} from "../src/signalGateway/requests.js";

describe("signal gateway request validation", () => {
  it("parses the start payload without changing the current signal server rules", () => {
    expect(
      parseSignalGatewayStartRequest({
        gzipSdp: false,
        signalServerIndex: 1,
        roomConfig: {
          token: "room-token",
          signalServers: ["custom-signal-value"],
          timeout: 12_000,
          signalReconnectDelay: 1_500,
          appData: "{}",
        },
        joinContext: {
          capturedAt: "2026-07-20T00:00:00.000Z",
          deviceId: "desktop-1",
          forceJoin: true,
        },
      }),
    ).toEqual({
      gzipSdp: false,
      signalServerIndex: 1,
      roomConfig: {
        token: "room-token",
        signalServers: ["custom-signal-value"],
        timeout: 12_000,
        signalReconnectDelay: 1_500,
        reportToken: undefined,
        reportUrl: undefined,
        reportServerAddress: undefined,
        appData: "{}",
      },
      joinContext: {
        capturedAt: "2026-07-20T00:00:00.000Z",
        deviceId: "desktop-1",
        forceJoin: true,
      },
    });
  });

  it("passes through a well-formed streamerVersion override", () => {
    expect(parseSignalGatewayStartRequest({ streamerVersion: "V4.6.0" })).toMatchObject({
      streamerVersion: "V4.6.0",
    });
    expect(parseSignalGatewayStartRequest({}).streamerVersion).toBeUndefined();
  });

  it.each([
    ["start scalar", () => parseSignalGatewayStartRequest("invalid"), "Expected a JSON signal gateway payload"],
    ["start gzipSdp", () => parseSignalGatewayStartRequest({ gzipSdp: "false" }), "gzipSdp must be a boolean"],
    [
      "start streamerVersion CRLF",
      () => parseSignalGatewayStartRequest({ streamerVersion: "V4.6.0\r\nX-Injected: 1" }),
      "streamerVersion must match",
    ],
    [
      "start streamerVersion format",
      () => parseSignalGatewayStartRequest({ streamerVersion: "4.6.0" }),
      "streamerVersion must match",
    ],
    [
      "start streamerVersion type",
      () => parseSignalGatewayStartRequest({ streamerVersion: 46 }),
      "streamerVersion must match",
    ],
    [
      "start signalServers",
      () => parseSignalGatewayStartRequest({ roomConfig: { token: "token", signalServers: [1] } }),
      "roomConfig.signalServers must be a string array",
    ],
    ["control body", () => parseSignalControlRequest(null), "Expected a JSON control payload"],
    ["control id", () => parseSignalControlRequest({}), "appControlId is required"],
    ["SOAC type", () => parseSignalSoacRequest({ type: "unknown" }), "type must be one of"],
    [
      "SOAC candidate",
      () => parseSignalSoacRequest({ type: "candidate" }),
      "candidate is required for SOAC candidate messages",
    ],
    ["event cursor", () => parseOptionalEventId("1.5"), "after must be a non-negative integer"],
  ])("rejects invalid %s input with ValidationError", (_caseName, parse, message) => {
    expect(parse).toThrowError(ValidationError);
    expect(parse).toThrow(message);
  });

  it("parses control, SOAC and event cursor payloads", () => {
    expect(parseSignalControlRequest({ appControlId: "control-1", appDataBase64: "AQID" })).toEqual({
      appControlId: "control-1",
      appDataBase64: "AQID",
      streamerData: undefined,
    });
    expect(
      parseSignalSoacRequest({
        type: "candidate",
        candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
      }),
    ).toMatchObject({
      type: "candidate",
      candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
    });
    expect(parseOptionalEventId(undefined)).toBeUndefined();
    expect(parseOptionalEventId("12")).toBe(12);
  });
});
