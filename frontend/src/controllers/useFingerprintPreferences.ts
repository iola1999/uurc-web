import { useCallback, useEffect, useState } from "react";

import { normalizeFingerprintConfig, type FingerprintConfig, type FingerprintPresetId } from "@uurc/shared/fingerprint";

import { fingerprintPresetById, readFingerprintConfig, writeFingerprintConfig } from "../uu/fingerprintStore.js";

export function useFingerprintPreferences() {
  const [fingerprint, setFingerprint] = useState<FingerprintConfig>(readFingerprintConfig);

  useEffect(() => {
    writeFingerprintConfig(fingerprint);
  }, [fingerprint]);

  const applyFingerprintPatch = useCallback((patch: Partial<FingerprintConfig>) => {
    setFingerprint((current) => normalizeFingerprintConfig({ ...current, ...patch }));
  }, []);

  const selectFingerprintPreset = useCallback((preset: FingerprintPresetId) => {
    // custom 是字段偏离预设后的派生状态,选中它保持当前字段值
    if (preset === "custom") return;
    setFingerprint(fingerprintPresetById(preset));
  }, []);

  return { fingerprint, applyFingerprintPatch, selectFingerprintPreset };
}
