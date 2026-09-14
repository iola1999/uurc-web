import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FINGERPRINT_CONFIG } from "@uurc/shared/fingerprint";
import { VERSION_CODE, VERSION_NAME } from "@uurc/shared/constants";

import { FINGERPRINT_STORAGE_KEY, readFingerprintConfig, writeFingerprintConfig } from "../src/uu/fingerprintStore.js";
import { buildSignedHeaders } from "../src/uu/signing.js";

if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import("node:crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: webcrypto });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-14T00:00:00.000Z"));
});

describe("fingerprint store", () => {
  it("falls back to defaults when localStorage is corrupted or missing", () => {
    expect(readFingerprintConfig()).toEqual(DEFAULT_FINGERPRINT_CONFIG);
    localStorage.setItem(FINGERPRINT_STORAGE_KEY, "{corrupted");
    expect(readFingerprintConfig()).toEqual(DEFAULT_FINGERPRINT_CONFIG);
  });

  it("round-trips a normalized custom config", () => {
    writeFingerprintConfig({ ...DEFAULT_FINGERPRINT_CONFIG, appVersionName: "8.8.8" });
    expect(readFingerprintConfig()).toEqual({
      ...DEFAULT_FINGERPRINT_CONFIG,
      preset: "custom",
      appVersionName: "8.8.8",
    });
  });
});

describe("signed request headers", () => {
  const request = { state: {}, method: "GET", pathWithQuery: "/api/v1/device/groups/of/my" } as const;

  it("uses the default fingerprint when no override is stored", async () => {
    const headers = await buildSignedHeaders({ ...request });
    expect(headers["X-Param-VN"]).toBe(VERSION_NAME);
    expect(headers["X-Param-VC"]).toBe(VERSION_CODE);
    expect(headers["X-Param-PLAT"]).toBe("2");
  });

  it("applies stored overrides and recomputes the signature over them", async () => {
    const baseline = await buildSignedHeaders({ ...request });
    writeFingerprintConfig({
      ...DEFAULT_FINGERPRINT_CONFIG,
      appVersionName: "9.9.9",
      appVersionCode: "999000",
      httpPlatform: "7",
    });
    const overridden = await buildSignedHeaders({ ...request });
    expect(overridden["X-Param-VN"]).toBe("9.9.9");
    expect(overridden["X-Param-VC"]).toBe("999000");
    expect(overridden["X-Param-PLAT"]).toBe("7");
    // 时间已冻结,签名差异只能来自被覆盖的 header
    expect(overridden["X-Param-TS"]).toBe(baseline["X-Param-TS"]);
    expect(overridden["X-Param-SIGN"]).not.toBe(baseline["X-Param-SIGN"]);
  });
});
