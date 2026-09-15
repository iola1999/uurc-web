import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectDirectSignalExtension,
  peekDirectSignalExtension,
  postToExtension,
  resetDirectSignalExtensionCache,
  setExtensionSignalHeaders,
} from "../src/direct/extensionBridge.js";

// 模拟 content script:收到页面 postMessage 后按协议回发 *-result
function installFakeContentScript(options: { respondToPing?: boolean; version?: string; setHeadersOk?: boolean } = {}) {
  const { respondToPing = true, version = "0.1.0", setHeadersOk = true } = options;
  const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const listener = (event: MessageEvent) => {
    if (event.source !== window && event.source !== null) return;
    const message = event.data as { type?: string; requestId?: string; headers?: Record<string, string> };
    if (!message || typeof message.requestId !== "string" || !message.type) return;
    if (message.type === "uurc-ext-ping") {
      received.push({ type: message.type, payload: {} });
      if (respondToPing) {
        window.postMessage({ type: "uurc-ext-ping-result", requestId: message.requestId, ok: true, version }, "*");
      }
      return;
    }
    if (message.type === "uurc-set-signal-headers") {
      received.push({ type: message.type, payload: { headers: message.headers ?? {} } });
      window.postMessage(
        {
          type: "uurc-set-signal-headers-result",
          requestId: message.requestId,
          ok: setHeadersOk,
          error: setHeadersOk ? undefined : "header not allowed: X-Evil",
        },
        "*",
      );
      return;
    }
    if (message.type === "uurc-clear-signal-headers") {
      received.push({ type: message.type, payload: {} });
      window.postMessage({ type: "uurc-clear-signal-headers-result", requestId: message.requestId, ok: true }, "*");
    }
  };
  window.addEventListener("message", listener);
  return {
    received,
    uninstall() {
      window.removeEventListener("message", listener);
    },
  };
}

describe("direct signal extension bridge", () => {
  let bridge: ReturnType<typeof installFakeContentScript> | null = null;

  beforeEach(() => {
    resetDirectSignalExtensionCache();
  });

  afterEach(() => {
    bridge?.uninstall();
    bridge = null;
    vi.useRealTimers();
  });

  it("resolves an available extension with its version and caches the positive result", async () => {
    bridge = installFakeContentScript({ version: "0.1.0" });

    const info = await detectDirectSignalExtension();

    expect(info).toEqual({ available: true, version: "0.1.0", reason: "" });
    expect(peekDirectSignalExtension()?.available).toBe(true);
    expect(bridge.received).toHaveLength(1);

    // 正缓存命中,不再发 ping
    await detectDirectSignalExtension();
    expect(bridge.received).toHaveLength(1);
  });

  it("falls back to a negative reason string when no extension answers the ping", async () => {
    vi.useFakeTimers();
    bridge = installFakeContentScript({ respondToPing: false });

    const pending = detectDirectSignalExtension();
    await vi.advanceTimersByTimeAsync(2_600);
    const info = await pending;

    expect(info.available).toBe(false);
    expect(info.reason).toContain("Direct Signal");
    // 负结果进入短期缓存,同步可读
    expect(peekDirectSignalExtension()?.available).toBe(false);
  });

  it("propagates extension-side rule rejection from setExtensionSignalHeaders", async () => {
    bridge = installFakeContentScript({ setHeadersOk: false });

    await expect(setExtensionSignalHeaders({ "X-NRD-AUTH": "synthetic" })).rejects.toThrow("header not allowed");
  });

  it("delivers the headers dictionary to the content script", async () => {
    bridge = installFakeContentScript();

    await setExtensionSignalHeaders({ "X-NRD-AUTH": "synthetic", streamer_version: "V4.6.0" });

    expect(bridge.received.at(-1)).toEqual({
      type: "uurc-set-signal-headers",
      payload: { headers: { "X-NRD-AUTH": "synthetic", streamer_version: "V4.6.0" } },
    });
  });

  it("rejects when the extension never responds to a bridge message", async () => {
    vi.useFakeTimers();
    // 不安装模拟 content script:消息无人应答,只能等超时

    const pending = postToExtension("uurc-set-signal-headers", { headers: {} }, 1_000);
    const assertion = expect(pending).rejects.toThrow("等待扩展响应超时");
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
  });
});
