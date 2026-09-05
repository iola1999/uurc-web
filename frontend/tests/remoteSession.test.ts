import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRemoteSessionId } from "../src/api/remoteSession.js";

describe("remote session capability", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("keeps one opaque identifier in the current document", () => {
    const first = getRemoteSessionId();
    const second = getRemoteSessionId();

    expect(first).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(second).toBe(first);
    expect(window.sessionStorage.getItem("uurc.remoteSessionId")).toBeNull();
  });

  it("does not reuse a capability copied from another document", async () => {
    const original = getRemoteSessionId();
    window.sessionStorage.setItem("uurc.remoteSessionId", original);
    vi.resetModules();
    const nextDocument = await import("../src/api/remoteSession.js");
    expect(nextDocument.getRemoteSessionId()).not.toBe(original);
  });
});
