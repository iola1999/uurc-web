import type { RemoteSignalGatewayEvent, RemoteSignalGatewayStatus } from "@uurc/shared/signalGateway/model";
import type { StreamerControlPeerNetworkInfo, StreamerSignalControlResult } from "@uurc/shared/streamer/signalControl";

export function formatSignalGatewayErrorHint(status: RemoteSignalGatewayStatus | null): string {
  if (status?.status !== "error") return "";
  const detail = status.error?.trim() || "未知错误";
  return `连接失败：${detail}`;
}

export function formatControlRoutingDecision(result: StreamerSignalControlResult | null | undefined): string {
  if (!result) return "-";
  return [
    `force_relay=${formatOptionalBoolean(result.forceRelay)}`,
    `auto_switch=${formatOptionalBoolean(result.autoSwitchNetwork)}`,
    `relay_ins_type=${result.relayInsType ?? "-"}`,
  ].join(" · ");
}

export function formatPeerNetworkInfo(info: StreamerControlPeerNetworkInfo | undefined): string {
  if (!info) return "-";
  const region = [info.country, info.province, info.city].filter(Boolean).join(" ");
  const isp = info.isp ? (info.relayIsp ? `${info.isp}(中转:${info.relayIsp})` : info.isp) : (info.relayIsp ?? "");
  const parts = [region, isp].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function formatOptionalBoolean(value: boolean | undefined): string {
  return value === undefined ? "-" : value ? "是" : "否";
}

export function summarizeSwitchNetworkNotify(events: readonly RemoteSignalGatewayEvent[]): string {
  let latest: RemoteSignalGatewayEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.direction === "inbound" && event.event === "switch_network_notify") {
      latest = event;
      break;
    }
  }
  if (!latest) return "-";

  const payloads = Array.isArray(latest.payload) ? latest.payload : [latest.payload];
  const record = payloads.map(asRecord).find((item) => item !== null);
  if (!record) return "received";

  const transportType = numberValue(record.transport_type);
  const attemptSwitchType = numberValue(record.attempt_switch_type);
  return [
    transportType === undefined ? null : `transport=${transportType}`,
    attemptSwitchType === undefined ? null : `attempt=${attemptSwitchType}`,
    `ice=${typeof record.ice_id === "string" && record.ice_id.length > 0 ? "yes" : "no"}`,
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");
}

const KNOWN_SIGNAL_EVENT_NAMES = new Set([
  "control",
  "control:ack",
  "soac",
  "soac:ack",
  "answer",
  "candidate",
  "restart_ice",
  "switch_network_notify",
  "leave",
  "left",
  "released",
  "bmsg_push",
  "publisher_disconnect",
  "be-controlled",
  "streamer_push",
  "forward_setting",
]);

export function summarizeUnexpectedSignalEvents(
  events: readonly RemoteSignalGatewayEvent[],
  appDirectEvents: readonly string[],
): string {
  const known = new Set([...KNOWN_SIGNAL_EVENT_NAMES, ...appDirectEvents]);
  const names: string[] = [];

  for (const event of events) {
    if (event.direction !== "inbound" || known.has(event.event) || names.includes(event.event)) continue;
    names.push(event.event);
  }

  if (names.length === 0) return "-";
  const visible = names.slice(0, 6);
  const suffix = names.length > visible.length ? ` +${names.length - visible.length}` : "";
  return `${visible.join(", ")}${suffix}`;
}

export function formatAutoSwitchThresholds(result: StreamerSignalControlResult | null | undefined): string {
  if (!result) return "-";
  const possible = [
    formatMetricNumber("pkt", result.possibleAutoSwitchPacketLoss),
    formatMetricNumber("latency", result.possibleAutoSwitchLatency),
  ].filter((item): item is string => item !== null);
  const force = [
    formatMetricNumber("pkt", result.forceAutoSwitchPacketLoss),
    formatMetricNumber("latency", result.forceAutoSwitchLatency),
  ].filter((item): item is string => item !== null);
  const parts = [
    possible.length > 0 ? `possible ${possible.join(" ")}` : null,
    force.length > 0 ? `force ${force.join(" ")}` : null,
  ].filter((item): item is string => item !== null);

  return parts.length > 0 ? parts.join(" / ") : "-";
}

export function formatSignalGatewayState(state: string): string {
  switch (state) {
    case "idle":
      return "未启动";
    case "connecting":
      return "连接中";
    case "connected":
      return "已连接";
    case "closed":
      return "已关闭";
    case "error":
      return "异常";
    default:
      return state;
  }
}

function formatMetricNumber(label: string, value: number | undefined): string | null {
  return value === undefined ? null : `${label}=${value}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
