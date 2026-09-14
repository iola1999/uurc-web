import { getStoredLoginState } from "./loginStateStore.js";

const LAST_SIGNAL_SESSION_KEY = "uurc.lastSignalSession";
// 与 roomSessionStore 的过期策略对齐：超过一天的记录不再参与占用识别。
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface LastSignalSession {
  capturedAt: string;
  clientId: string;
  deviceId: string;
  userId: string;
}

// 网关加入 UU 房间时不发送 client_id，信令服务器按连接分配并在 control ack 里返回。
// 设备列表 participants_info 的 client_id 与那个值同命名空间，与登录态的 clientId 无关，
// 所以刷新后要认出「占用者是自己上一个会话」，只能靠这里记住的上一个会话 client_id。
export function rememberLastSignalSession(input: { clientId: string; deviceId: string; userId: string }): void {
  if (!input.clientId || !input.deviceId) return;
  try {
    const record: LastSignalSession = { ...input, capturedAt: new Date().toISOString() };
    window.localStorage.setItem(LAST_SIGNAL_SESSION_KEY, JSON.stringify(record));
  } catch {
    // 存储不可用时跳过，占用识别退回到登录态 clientId 比对。
  }
}

export function getLastSignalSessionClientId(deviceId: string): string {
  if (!deviceId) return "";
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LAST_SIGNAL_SESSION_KEY);
  } catch {
    return "";
  }
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as Partial<LastSignalSession>;
    const clientId = typeof parsed.clientId === "string" ? parsed.clientId : "";
    const storedDeviceId = typeof parsed.deviceId === "string" ? parsed.deviceId : "";
    const storedUserId = typeof parsed.userId === "string" ? parsed.userId : "";
    const capturedAt = typeof parsed.capturedAt === "string" ? Date.parse(parsed.capturedAt) : Number.NaN;
    if (!clientId || storedDeviceId !== deviceId) return "";
    if (storedUserId !== getStoredLoginState()?.userId) return "";
    if (!Number.isFinite(capturedAt) || Date.now() - capturedAt > MAX_AGE_MS) return "";
    return clientId;
  } catch {
    return "";
  }
}
