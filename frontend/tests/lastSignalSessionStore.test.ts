import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLastSignalSessionClientId, rememberLastSignalSession } from "../src/uu/lastSignalSessionStore.js";

const LOGIN_STATE_KEY = "uurc.loginState";
const LAST_SIGNAL_SESSION_KEY = "uurc.lastSignalSession";

function seedLogin(userId: string): void {
  window.localStorage.setItem(LOGIN_STATE_KEY, JSON.stringify({ token: "a.b.c", userId, deviceId: "self-1" }));
}

describe("lastSignalSessionStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedLogin("user-1");
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("returns the remembered client id for the same device and account", () => {
    rememberLastSignalSession({ clientId: "signal-1", deviceId: "desktop-1", userId: "user-1" });

    expect(getLastSignalSessionClientId("desktop-1")).toBe("signal-1");
    expect(getLastSignalSessionClientId("desktop-2")).toBe("");
  });

  it("ignores a record written by another account", () => {
    rememberLastSignalSession({ clientId: "signal-1", deviceId: "desktop-1", userId: "user-2" });

    expect(getLastSignalSessionClientId("desktop-1")).toBe("");
  });

  it("ignores a record older than a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"));
    rememberLastSignalSession({ clientId: "signal-1", deviceId: "desktop-1", userId: "user-1" });
    vi.setSystemTime(new Date("2026-09-15T00:00:01.000Z"));

    expect(getLastSignalSessionClientId("desktop-1")).toBe("");
  });

  it("returns empty when the stored record is malformed", () => {
    window.localStorage.setItem(LAST_SIGNAL_SESSION_KEY, "{not json");

    expect(getLastSignalSessionClientId("desktop-1")).toBe("");
  });
});
