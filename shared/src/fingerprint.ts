import { VERSION_CODE, VERSION_NAME } from "./constants.js";
import { STREAMER_CLIENT_TYPES } from "./streamer/connectOptionsModel.js";
import { STREAMER_CLIENT_VERSION } from "./streamer/internal/signalSchema.js";

export const FINGERPRINT_PRESET_IDS = ["android-v4", "android-legacy", "custom"] as const;
export type FingerprintPresetId = (typeof FINGERPRINT_PRESET_IDS)[number];

// 对齐 STREAMER_CLIENT_TYPES 的非零取值;"auto" 保留按被控端平台选择的既有逻辑
export type FingerprintClientType = "auto" | 1 | 2 | 3 | 4;

export interface FingerprintConfig {
  preset: FingerprintPresetId;
  /** 信令握手 header streamer_version,进入 WebSocket 握手,格式受 STREAMER_VERSION_PATTERN 约束 */
  streamerVersion: string;
  /** X-Param-VN 与 connect options client_version */
  appVersionName: string;
  /** X-Param-VC */
  appVersionCode: string;
  /** X-Param-PLAT */
  httpPlatform: string;
  /** connect options client_type */
  clientType: FingerprintClientType;
}

export const STREAMER_VERSION_PATTERN = /^V\d{1,2}\.\d{1,2}\.\d{1,2}$/;
const APP_VERSION_NAME_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const APP_VERSION_CODE_PATTERN = /^\d{1,9}$/;
const HTTP_PLATFORM_PATTERN = /^\d{1,2}$/;
const CLIENT_TYPE_VALUES: readonly number[] = [
  STREAMER_CLIENT_TYPES.Client_IOS,
  STREAMER_CLIENT_TYPES.Client_ANDROID,
  STREAMER_CLIENT_TYPES.Client_WINDOWS,
  STREAMER_CLIENT_TYPES.Client_MAC,
];

type FingerprintPresetIdWithoutCustom = Exclude<FingerprintPresetId, "custom">;

export const FINGERPRINT_PRESETS: Record<FingerprintPresetIdWithoutCustom, FingerprintConfig> = {
  "android-v4": {
    preset: "android-v4",
    streamerVersion: STREAMER_CLIENT_VERSION,
    appVersionName: VERSION_NAME,
    appVersionCode: VERSION_CODE,
    httpPlatform: "2",
    clientType: "auto",
  },
  // 4.23 时代的历史指纹,仅供 A/B 对照实验,这里是旧版本值唯一允许出现的地方
  "android-legacy": {
    preset: "android-legacy",
    streamerVersion: "V3.1.14",
    appVersionName: "4.23.0",
    appVersionCode: "423000",
    httpPlatform: "2",
    clientType: "auto",
  },
};

export const DEFAULT_FINGERPRINT_CONFIG: FingerprintConfig = FINGERPRINT_PRESETS["android-v4"];

const FINGERPRINT_FIELDS = [
  "streamerVersion",
  "appVersionName",
  "appVersionCode",
  "httpPlatform",
  "clientType",
] as const satisfies readonly (keyof FingerprintConfig)[];

export function normalizeFingerprintConfig(value: unknown): FingerprintConfig {
  const base: FingerprintConfig = { ...DEFAULT_FINGERPRINT_CONFIG };
  if (!value || typeof value !== "object") return base;
  const record = value as Record<string, unknown>;
  const streamerVersion = normalizedStringField(record.streamerVersion, STREAMER_VERSION_PATTERN);
  if (streamerVersion !== null) base.streamerVersion = streamerVersion;
  const appVersionName = normalizedStringField(record.appVersionName, APP_VERSION_NAME_PATTERN);
  if (appVersionName !== null) base.appVersionName = appVersionName;
  const appVersionCode = normalizedStringField(record.appVersionCode, APP_VERSION_CODE_PATTERN);
  if (appVersionCode !== null) base.appVersionCode = appVersionCode;
  const httpPlatform = normalizedStringField(record.httpPlatform, HTTP_PLATFORM_PATTERN);
  if (httpPlatform !== null) base.httpPlatform = httpPlatform;
  const clientType = normalizedClientType(record.clientType);
  if (clientType !== null) base.clientType = clientType;
  base.preset = deriveFingerprintPreset(base);
  return base;
}

export function resolveFingerprintClientType(config: FingerprintConfig, targetPlatform: number | undefined): number {
  if (config.clientType !== "auto") return config.clientType;
  return targetPlatform === STREAMER_CLIENT_TYPES.Client_MAC
    ? STREAMER_CLIENT_TYPES.Client_MAC
    : STREAMER_CLIENT_TYPES.Client_ANDROID;
}

export function summarizeFingerprintConfig(config: FingerprintConfig): string {
  return [
    `streamer=${config.streamerVersion}`,
    `VN=${config.appVersionName}`,
    `VC=${config.appVersionCode}`,
    `PLAT=${config.httpPlatform}`,
    `client_type=${config.clientType}`,
  ].join(" · ");
}

function normalizedStringField(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function normalizedClientType(value: unknown): FingerprintClientType | null {
  if (value === "auto") return "auto";
  const numeric = typeof value === "number" ? value : Number(value);
  return CLIENT_TYPE_VALUES.includes(numeric) ? (numeric as Exclude<FingerprintClientType, "auto">) : null;
}

function deriveFingerprintPreset(config: FingerprintConfig): FingerprintPresetId {
  for (const presetId of Object.keys(FINGERPRINT_PRESETS) as FingerprintPresetIdWithoutCustom[]) {
    const preset = FINGERPRINT_PRESETS[presetId];
    if (FINGERPRINT_FIELDS.every((field) => config[field] === preset[field])) return presetId;
  }
  return "custom";
}
