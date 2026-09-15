// 页面与 UURC Direct Signal 扩展(extension/)之间的桥。
// 浏览器 WebSocket API 设置不了握手 header,扩展用 declarativeNetRequest
// 会话规则给 UU 信令域名的 websocket 握手注入认证 header;本模块负责探测
// 扩展、下发 header 规则与清理规则。

export interface DirectSignalExtensionInfo {
  available: boolean;
  version?: string;
  // 不可用原因(空串 = 可用),对齐 detectBrowserWebRtcUnavailableReason 的原因串范式
  reason: string;
}

interface BridgeResponse {
  ok?: boolean;
  error?: string;
  version?: string;
}

const EXTENSION_PING_TIMEOUT_MS = 2_500;
const SET_HEADERS_TIMEOUT_MS = 5_000;
// 探测成功缓存到页面卸载;失败结果只做短期缓存,避免每次 start 都重发 ping,
// 同时保证装上扩展后无需刷新页面太久即可生效
const NEGATIVE_CACHE_TTL_MS = 30_000;

let cachedDetection: { info: DirectSignalExtensionInfo; at: number } | null = null;
let inflightDetection: Promise<DirectSignalExtensionInfo> | null = null;

export function postToExtension(
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = SET_HEADERS_TIMEOUT_MS,
): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const responseType = `${type}-result`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`${type} 等待扩展响应超时`));
    }, timeoutMs);
    function onMessage(event: MessageEvent): void {
      if (!isSameWindowMessage(event)) return;
      const data = event.data as (BridgeResponse & { type?: string; requestId?: string }) | null;
      if (!data || data.requestId !== requestId || data.type !== responseType) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type, requestId, ...payload }, "*");
  });
}

// 同步读取缓存的探测结果;null 表示尚未探测完成或负缓存已过期。
// 信令启动路径用它避免被 ping 超时阻塞(未装扩展的浏览器每次启动都会白等一轮)。
export function peekDirectSignalExtension(): DirectSignalExtensionInfo | null {
  if (!cachedDetection) return null;
  if (cachedDetection.info.available) return cachedDetection.info;
  return Date.now() - cachedDetection.at < NEGATIVE_CACHE_TTL_MS ? cachedDetection.info : null;
}

export function detectDirectSignalExtension(): Promise<DirectSignalExtensionInfo> {
  const cached = peekDirectSignalExtension();
  if (cached) return Promise.resolve(cached);
  inflightDetection ??= runDirectSignalDetection().finally(() => {
    inflightDetection = null;
  });
  return inflightDetection;
}

// 挂载时预热探测,用户点连接时结果通常已就绪
export function warmUpDirectSignalExtensionDetection(): void {
  detectDirectSignalExtension().catch(() => {});
}

async function runDirectSignalDetection(): Promise<DirectSignalExtensionInfo> {
  let info: DirectSignalExtensionInfo;
  try {
    const response = await postToExtension("uurc-ext-ping", {}, EXTENSION_PING_TIMEOUT_MS);
    info = response.ok
      ? { available: true, version: response.version, reason: "" }
      : { available: false, reason: `扩展响应异常：${response.error ?? "未知错误"}` };
  } catch {
    info = {
      available: false,
      reason:
        "未检测到 Direct Signal 扩展。需要浏览器直连信令时,请在 chrome://extensions 加载仓库 extension/ 目录,并确认本站点在扩展 manifest 的 matches 中。",
    };
  }
  cachedDetection = { info, at: Date.now() };
  return info;
}

export async function setExtensionSignalHeaders(headers: Record<string, string>): Promise<void> {
  const response = await postToExtension("uurc-set-signal-headers", { headers });
  if (!response.ok) throw new Error(`扩展写入信令 header 规则失败：${response.error ?? "未知错误"}`);
}

export async function clearExtensionSignalHeaders(): Promise<void> {
  try {
    await postToExtension("uurc-clear-signal-headers");
  } catch {
    // 规则清理失败不阻断断开流程;会话规则随浏览器关闭必然消失
  }
}

export function resetDirectSignalExtensionCache(): void {
  cachedDetection = null;
}

// 同窗口消息校验:真实浏览器里 event.source === window,跨 frame 消息的 source
// 是对方的 WindowProxy,会被拒绝;jsdom 的同窗口 postMessage source 为 null,放行。
function isSameWindowMessage(event: MessageEvent): boolean {
  return event.source === window || event.source === null;
}
