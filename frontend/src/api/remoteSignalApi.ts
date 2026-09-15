import type {
  RemoteSignalControlRequest,
  RemoteSignalControlResult,
  RemoteSignalGatewayEvent,
  RemoteSignalGatewayStartRequest,
  RemoteSignalGatewayStatus,
  RemoteSignalSoacRequest,
  RemoteSignalSoacResult,
} from "@uurc/shared/signalGateway/model";
import type { RemoteSignalReadinessDiagnostics } from "@uurc/shared/streamer/readiness";

import type { ConnectionRouteMode, SignalChannelMode } from "../app/remoteControlTypes.js";
import { DirectSignalClient } from "../direct/directSignalClient.js";
import {
  detectDirectSignalExtension,
  peekDirectSignalExtension,
  warmUpDirectSignalExtensionDetection,
} from "../direct/extensionBridge.js";
import { getRemoteSignalStartContext } from "../uu/roomApi.js";
import { requestJson } from "./httpClient.js";

interface SignalChannelPreference {
  channelMode: SignalChannelMode;
  routeMode: ConnectionRouteMode;
}

// auto 模式下同一页面会话内直连连续失败达到上限后粘滞回退网关,防止重连抖动循环
const DIRECT_FAILURE_STICKY_LIMIT = 2;

let channelPreference: SignalChannelPreference = { channelMode: "auto", routeMode: "auto" };
let activeDirectClient: DirectSignalClient | null = null;
let consecutiveDirectFailures = 0;

export function setSignalChannelPreference(preference: SignalChannelPreference): void {
  channelPreference = preference;
}

// 仅供测试复位模块级状态
export function resetSignalChannelDispatch(): void {
  channelPreference = { channelMode: "auto", routeMode: "auto" };
  activeDirectClient = null;
  consecutiveDirectFailures = 0;
}

export async function startRemoteSignalGateway(
  input: RemoteSignalGatewayStartRequest = {},
): Promise<RemoteSignalGatewayStatus> {
  const request: RemoteSignalGatewayStartRequest = { ...input, ...getRemoteSignalStartContext() };
  // 重入 start(重连/切换路径)先停掉旧的直连客户端:防止旧 socket 泄漏,
  // 且旧客户端的规则清理必须发生在新客户端写入 header 规则之前
  const previousDirect = activeDirectClient;
  activeDirectClient = null;
  if (previousDirect) {
    try {
      await previousDirect.stop();
    } catch {
      // 旧客户端停止失败不阻断新的启动
    }
  }
  if ((await resolveSignalChannel()) === "direct") {
    const client = new DirectSignalClient();
    let directStatus: RemoteSignalGatewayStatus | null = null;
    try {
      directStatus = await client.start(request);
    } catch (error) {
      if (channelPreference.channelMode === "direct") throw error;
    }
    if (directStatus?.status === "connected") {
      activeDirectClient = client;
      consecutiveDirectFailures = 0;
      return directStatus;
    }
    consecutiveDirectFailures += 1;
    if (channelPreference.channelMode === "direct") {
      if (directStatus) return directStatus;
      throw new Error("浏览器直连信令启动失败");
    }
    // auto:直连失败,回退部署侧网关
  }
  return requestJson<RemoteSignalGatewayStatus>(
    "/api/remote/signal/start",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
    true,
  );
}

export async function stopRemoteSignalGateway(): Promise<RemoteSignalGatewayStatus> {
  // 双路径 best-effort:同一页面会话内可能先直连后回退网关(或手动切换),
  // 两条路径都要停;HTTP DELETE 幂等,顺带触发 Node 侧会话注册表回收
  const direct = activeDirectClient;
  activeDirectClient = null;
  const [directResult, httpResult] = await Promise.allSettled([
    direct ? direct.stop() : Promise.resolve(null),
    requestJson<RemoteSignalGatewayStatus>("/api/remote/signal", { method: "DELETE" }, true),
  ]);
  const directStatus = directResult.status === "fulfilled" ? directResult.value : null;
  if (httpResult.status === "fulfilled") return directStatus ?? httpResult.value;
  if (directStatus) return directStatus;
  throw httpResult.reason;
}

export async function getRemoteSignalEvents(afterEventId?: number): Promise<RemoteSignalGatewayEvent[]> {
  if (activeDirectClient) return activeDirectClient.getEvents(afterEventId ?? 0);
  const query = afterEventId && afterEventId > 0 ? `?after=${afterEventId}` : "";
  return requestJson<RemoteSignalGatewayEvent[]>(`/api/remote/signal/events${query}`, {}, true);
}

export async function getRemoteSignalDiagnostics(): Promise<RemoteSignalReadinessDiagnostics> {
  if (activeDirectClient) return activeDirectClient.getDiagnostics();
  return requestJson<RemoteSignalReadinessDiagnostics>("/api/remote/signal/diagnostics", {}, true);
}

export async function sendRemoteSignalControl(input: RemoteSignalControlRequest): Promise<RemoteSignalControlResult> {
  if (activeDirectClient) {
    const result = await activeDirectClient.sendControl(input);
    // 与网关路由的 409 响应保持同文案,前端错误提示与测试不需要区分路径
    if (!result) throw new Error("Start the signal gateway before sending control");
    return result;
  }
  return requestJson<RemoteSignalControlResult>(
    "/api/remote/signal/control",
    { method: "POST", body: JSON.stringify(input) },
    true,
  );
}

export async function sendRemoteSignalSoac(input: RemoteSignalSoacRequest): Promise<RemoteSignalSoacResult> {
  if (activeDirectClient) {
    const result = await activeDirectClient.sendSoac(input);
    if (!result) throw new Error("Start the signal gateway before sending SOAC");
    return result;
  }
  return requestJson<RemoteSignalSoacResult>(
    "/api/remote/signal/soac",
    { method: "POST", body: JSON.stringify(input) },
    true,
  );
}

async function resolveSignalChannel(): Promise<"direct" | "gateway"> {
  // 「强制 UU 中转」依赖服务端 force_relay 下发,浏览器直连拿不到该判定,固定走网关
  if (channelPreference.channelMode === "gateway" || channelPreference.routeMode === "relay") return "gateway";
  const cached = peekDirectSignalExtension();
  if (channelPreference.channelMode === "direct") {
    // 显式直连:等待探测完成,没有扩展时抛出原因串交给 UI 展示
    const info = cached ?? (await detectDirectSignalExtension());
    if (!info.available) throw new Error(info.reason || "未检测到 Direct Signal 扩展");
    return "direct";
  }
  if (consecutiveDirectFailures >= DIRECT_FAILURE_STICKY_LIMIT) return "gateway";
  if (cached) return cached.available ? "direct" : "gateway";
  // 探测未完成时本次先走网关,不阻塞启动;探测就绪后下次启动生效
  warmUpDirectSignalExtensionDetection();
  return "gateway";
}
