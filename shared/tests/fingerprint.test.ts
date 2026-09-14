import { describe, expect, it } from "vitest";

import { VERSION_CODE, VERSION_NAME } from "../src/constants.js";
import {
  DEFAULT_FINGERPRINT_CONFIG,
  FINGERPRINT_PRESETS,
  STREAMER_VERSION_PATTERN,
  normalizeFingerprintConfig,
  resolveFingerprintClientType,
  summarizeFingerprintConfig,
} from "../src/fingerprint.js";
import { STREAMER_CLIENT_TYPES } from "../src/streamer/connectOptionsModel.js";
import { STREAMER_CLIENT_VERSION } from "../src/streamer/internal/signalSchema.js";

describe("client fingerprint config", () => {
  it("derives the default preset from the shared version constants", () => {
    expect(FINGERPRINT_PRESETS["android-v4"]).toEqual({
      preset: "android-v4",
      streamerVersion: STREAMER_CLIENT_VERSION,
      appVersionName: VERSION_NAME,
      appVersionCode: VERSION_CODE,
      httpPlatform: "2",
      clientType: "auto",
    });
    expect(DEFAULT_FINGERPRINT_CONFIG).toEqual(FINGERPRINT_PRESETS["android-v4"]);
    // 旧版预设是历史值的唯一副本,供 A/B 对照实验回滚
    expect(FINGERPRINT_PRESETS["android-legacy"]).toMatchObject({
      streamerVersion: "V3.1.14",
      appVersionName: "4.23.0",
      appVersionCode: "423000",
    });
  });

  it("falls back to defaults for missing or malformed input", () => {
    expect(normalizeFingerprintConfig(undefined)).toEqual(DEFAULT_FINGERPRINT_CONFIG);
    expect(normalizeFingerprintConfig("garbage")).toEqual(DEFAULT_FINGERPRINT_CONFIG);
    expect(normalizeFingerprintConfig({ streamerVersion: "V4.6.0\r\nX-Injected: 1" })).toEqual(
      DEFAULT_FINGERPRINT_CONFIG,
    );
    expect(normalizeFingerprintConfig({ appVersionCode: "abc" })).toEqual(DEFAULT_FINGERPRINT_CONFIG);
  });

  it("keeps valid custom fields and derives the preset label", () => {
    const normalized = normalizeFingerprintConfig({
      preset: "android-v4",
      streamerVersion: "V4.6.0",
      appVersionName: "9.9.9",
      clientType: 3,
    });
    expect(normalized).toEqual({
      preset: "custom",
      streamerVersion: "V4.6.0",
      appVersionName: "9.9.9",
      appVersionCode: VERSION_CODE,
      httpPlatform: "2",
      clientType: 3,
    });
    expect(normalizeFingerprintConfig(FINGERPRINT_PRESETS["android-legacy"]).preset).toBe("android-legacy");
    expect(normalizeFingerprintConfig({ clientType: "4" }).clientType).toBe(4);
    expect(normalizeFingerprintConfig({ clientType: 9 }).clientType).toBe("auto");
  });

  it("validates the streamer version pattern used as a header injection guard", () => {
    expect(STREAMER_VERSION_PATTERN.test("V4.6.0")).toBe(true);
    expect(STREAMER_VERSION_PATTERN.test("V14.6.0")).toBe(true);
    expect(STREAMER_VERSION_PATTERN.test("V123.6.0")).toBe(false);
    expect(STREAMER_VERSION_PATTERN.test("v4.6.0")).toBe(false);
    expect(STREAMER_VERSION_PATTERN.test("V4.6.0 evil")).toBe(false);
  });

  it("resolves client_type with the existing target-platform behavior on auto", () => {
    expect(resolveFingerprintClientType(DEFAULT_FINGERPRINT_CONFIG, STREAMER_CLIENT_TYPES.Client_MAC)).toBe(
      STREAMER_CLIENT_TYPES.Client_MAC,
    );
    expect(resolveFingerprintClientType(DEFAULT_FINGERPRINT_CONFIG, STREAMER_CLIENT_TYPES.Client_WINDOWS)).toBe(
      STREAMER_CLIENT_TYPES.Client_ANDROID,
    );
    expect(resolveFingerprintClientType(DEFAULT_FINGERPRINT_CONFIG, undefined)).toBe(
      STREAMER_CLIENT_TYPES.Client_ANDROID,
    );
    expect(
      resolveFingerprintClientType(
        { ...DEFAULT_FINGERPRINT_CONFIG, clientType: STREAMER_CLIENT_TYPES.Client_MAC },
        STREAMER_CLIENT_TYPES.Client_WINDOWS,
      ),
    ).toBe(STREAMER_CLIENT_TYPES.Client_MAC);
  });

  it("summarizes the effective fingerprint in one line", () => {
    expect(summarizeFingerprintConfig(DEFAULT_FINGERPRINT_CONFIG)).toBe(
      `streamer=${STREAMER_CLIENT_VERSION} · VN=${VERSION_NAME} · VC=${VERSION_CODE} · PLAT=2 · client_type=auto`,
    );
  });
});
