import { describe, expect, it } from "vitest";
import { decodeJwtPayload, summarizeAuthState } from "../src/authState.js";

function fakeJwt(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${encoded}.signature`;
}

describe("auth state helpers", () => {
  it.each([null, [], 1, "payload", { exp: 1e300 }, { exp: -1e300 }])(
    "handles malformed JWT claims without crashing: %j",
    (payload) => {
      expect(() =>
        summarizeAuthState({ token: fakeJwt(payload), userId: "synthetic", deviceId: "synthetic" }),
      ).not.toThrow();
      expect(summarizeAuthState({ token: fakeJwt(payload) }).tokenExpiresAt).toBeUndefined();
    },
  );
  it("decodes JWT payloads without throwing on malformed tokens", () => {
    expect(decodeJwtPayload(fakeJwt({ client_id: "client-1", exp: 1893456000 }))).toMatchObject({
      client_id: "client-1",
      exp: 1893456000,
    });
    expect(decodeJwtPayload("not-a-jwt")).toEqual({});
  });

  it("summarizes login state without exposing the raw token", () => {
    const summary = summarizeAuthState({
      token: fakeJwt({ client_id: "client-1", exp: 1893456000 }),
      userId: "user-1",
      clientId: "client-1",
      deviceId: "device-1",
      oaid: "oaid-1",
      channel: "official",
    });

    expect(summary).toEqual({
      hasState: true,
      missingFields: [],
      userId: "user-1",
      clientId: "client-1",
      deviceId: "device-1",
      channel: "official",
      tokenExpiresAt: "2030-01-01T00:00:00.000Z",
      tokenExpired: false,
    });
  });

  it("reports missing required fields for incomplete login state", () => {
    const state = {
      token: "",
      userId: "user-1",
      deviceId: "",
    };

    expect(summarizeAuthState(state)).toMatchObject({
      hasState: false,
      missingFields: ["token", "deviceId"],
    });
  });
});
