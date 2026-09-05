import { describe, expect, it, vi } from "vitest";

import { RemoteControlSessionRegistry } from "../src/services/remoteControlSessionRegistry.js";

describe("RemoteControlSessionRegistry", () => {
  it("reuses a service within one session and isolates different sessions", () => {
    const registry = new RemoteControlSessionRegistry();

    const first = registry.getOrCreate("session-a");
    const same = registry.getOrCreate("session-a");
    const second = registry.getOrCreate("session-b");

    expect(same).toBe(first);
    expect(second).not.toBe(first);
    expect(registry.size).toBe(2);
  });

  it("expires idle sessions before creating another service", () => {
    let now = 0;
    const registry = new RemoteControlSessionRegistry(undefined, {
      idleTtlMs: 100,
      now: () => now,
    });
    const first = registry.getOrCreate("session-a");

    now = 100;
    registry.getOrCreate("session-b");

    expect(registry.size).toBe(1);
    expect(registry.getOrCreate("session-a")).not.toBe(first);
  });

  it("rejects new sessions at capacity and preserves existing sessions", () => {
    let now = 0;
    const registry = new RemoteControlSessionRegistry(undefined, {
      maxSessions: 2,
      idleTtlMs: 10_000,
      now: () => now,
    });
    const first = registry.getOrCreate("session-a");
    now = 1;
    registry.getOrCreate("session-b");
    now = 2;
    registry.getOrCreate("session-b");
    now = 3;
    expect(() => registry.getOrCreate("session-c")).toThrow("capacity");

    expect(registry.size).toBe(2);
    expect(registry.getOrCreate("session-a")).toBe(first);
    expect(registry.size).toBe(2);
  });

  it("expires without a subsequent request and renews active sessions", async () => {
    vi.useFakeTimers();
    try {
      const registry = new RemoteControlSessionRegistry(undefined, { idleTtlMs: 100 });
      const service = registry.getOrCreate("session-a");
      const stop = vi.spyOn(service, "stopSignalGateway");
      await vi.advanceTimersByTimeAsync(90);
      expect(registry.get("session-a")).toBe(service);
      await vi.advanceTimersByTimeAsync(90);
      expect(stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      expect(stop).toHaveBeenCalledOnce();
      expect(registry.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
