import {
  DEFAULT_FINGERPRINT_CONFIG,
  normalizeFingerprintConfig,
  type FingerprintConfig,
  type FingerprintPresetId,
  FINGERPRINT_PRESETS,
} from "@uurc/shared/fingerprint";

export const FINGERPRINT_STORAGE_KEY = "uurc.fingerprint";

export function readFingerprintConfig(): FingerprintConfig {
  try {
    const raw = globalThis.localStorage?.getItem(FINGERPRINT_STORAGE_KEY);
    if (!raw) return DEFAULT_FINGERPRINT_CONFIG;
    return normalizeFingerprintConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_FINGERPRINT_CONFIG;
  }
}

export function writeFingerprintConfig(config: FingerprintConfig): void {
  try {
    globalThis.localStorage?.setItem(FINGERPRINT_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 隐私模式或沙箱环境下放弃持久化,保持内存配置可用
  }
}

export function fingerprintPresetById(preset: FingerprintPresetId): FingerprintConfig {
  return preset === "custom" ? DEFAULT_FINGERPRINT_CONFIG : FINGERPRINT_PRESETS[preset];
}
