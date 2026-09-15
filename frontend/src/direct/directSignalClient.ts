import { STREAMER_VERSION_PATTERN } from "@uurc/shared/fingerprint";
import type { StreamerRoomConfig } from "@uurc/shared/roomConfig";
import type {
  RemoteSignalControlRequest,
  RemoteSignalControlResult,
  RemoteSignalGatewayEvent,
  RemoteSignalGatewayStartRequest,
  RemoteSignalGatewayStatus,
  RemoteSignalSoacRequest,
  RemoteSignalSoacResult,
} from "@uurc/shared/signalGateway/model";
import {
  buildSignalGatewayControlPayload,
  buildSignalGatewaySoacPayloadAsync,
  normalizeSignalGatewayPayload,
} from "@uurc/shared/signalGateway/payload";
import {
  SignalSocketEngine,
  type OpenSignalTransportInput,
  type SignalSocketTransport,
} from "@uurc/shared/signalGateway/signalSocket";
import { buildBrowserEngineIoWebSocketUrl } from "@uurc/shared/signalGateway/socketIoWire";
import {
  SIGNAL_GATEWAY_EVENT_RETENTION_MS,
  SIGNAL_GATEWAY_MAX_EVENTS,
  createIdleSignalGatewayStatus,
  createSignalGatewayStatus,
  orderSignalGatewayServers,
  redactSignalGatewayToken,
} from "@uurc/shared/signalGateway/status";
import type { RemoteSignalReadinessDiagnostics } from "@uurc/shared/streamer/readiness";
import { analyzeRemoteSignalReadiness } from "@uurc/shared/streamer/readiness";
import { normalizeStreamerSignalControlAck } from "@uurc/shared/streamer/signalControl";
import {
  STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  STREAMER_CONTROL_EVENT_NAME,
  buildStreamerSignalHeaders,
} from "@uurc/shared/streamer/signalSession";
import { STREAMER_SOAC_EVENT } from "@uurc/shared/streamer/signalSoac";

import { browserSignalGatewayBinary } from "./browserSignalBinaryCodec.js";
import { clearExtensionSignalHeaders, setExtensionSignalHeaders } from "./extensionBridge.js";

const DIRECT_SIGNAL_STRATEGY = "browser_direct_signal" as const;

// 浏览器直连信令客户端:信令 WebSocket 由浏览器直接打开(出口 = 浏览器所在网络),
// 握手 header 由 UURC Direct Signal 扩展注入。events/diagnostics/status 语义与
// 部署侧网关一致,remoteSignalApi 的分发层用本类替换 HTTP 调用后控制器无感知。
export class DirectSignalClient {
  private engine: SignalSocketEngine | null = null;
  private events: RemoteSignalGatewayEvent[] = [];
  private nextEventId = 1;
  private status: RemoteSignalGatewayStatus = createIdleSignalGatewayStatus(undefined, DIRECT_SIGNAL_STRATEGY);

  getStatus(): RemoteSignalGatewayStatus {
    if (this.status.status === "connected" && !this.engine?.connected) {
      return this.setStatus({
        ...this.status,
        status: "closed",
        connectionId: undefined,
        updatedAt: new Date().toISOString(),
        error: "Browser direct signal socket is no longer active; restart the signal connection.",
      });
    }
    return this.status;
  }

  getEvents(afterEventId = 0): RemoteSignalGatewayEvent[] {
    this.pruneEvents();
    return this.events.filter((event) => event.id > afterEventId);
  }

  getDiagnostics(): RemoteSignalReadinessDiagnostics {
    this.pruneEvents();
    return analyzeRemoteSignalReadiness({ events: this.events, signalStatus: this.getStatus() });
  }

  async start(input: RemoteSignalGatewayStartRequest): Promise<RemoteSignalGatewayStatus> {
    const roomConfig = input.roomConfig;
    if (!roomConfig?.token || !roomConfig.signalServers?.length) {
      return this.setStatus({
        ...createIdleSignalGatewayStatus(undefined, DIRECT_SIGNAL_STRATEGY),
        status: "error",
        updatedAt: new Date().toISOString(),
        error: "roomConfig with token and signalServers is required",
      });
    }
    // 直连路径不经过网关的 parseSignalGatewayStartRequest,这里执行同款校验:
    // streamerVersion 直接进入 WebSocket 握手 header,正则是 CRLF 注入防线
    if (input.streamerVersion !== undefined && !STREAMER_VERSION_PATTERN.test(input.streamerVersion)) {
      throw new Error(`streamerVersion must match ${STREAMER_VERSION_PATTERN.source}`);
    }

    this.closeEngine();
    this.events = [];
    this.nextEventId = 1;

    const startedAt = new Date().toISOString();
    const rawHeaders = buildStreamerSignalHeaders({
      token: roomConfig.token,
      gzipSdp: input.gzipSdp ?? true,
      streamerVersion: input.streamerVersion,
    });
    this.setStatus(
      createSignalGatewayStatus({
        status: "connecting",
        roomConfig,
        rawHeaders,
        startedAt,
        strategy: DIRECT_SIGNAL_STRATEGY,
      }),
    );

    // header 规则必须先于建连生效,否则裸握手会被服务端拒绝、误判为服务端故障
    try {
      await setExtensionSignalHeaders(rawHeaders);
    } catch (error) {
      return this.setErrorStatus(roomConfig, rawHeaders, startedAt, error);
    }

    // 扩展只被授权注入 *.nrd.nie.163.com,裸 IP 信令入口在直连模式下跳过
    const candidates = orderSignalGatewayServers(roomConfig.signalServers, input.signalServerIndex).filter(
      isDomainSignalServer,
    );
    if (candidates.length === 0) {
      await clearExtensionSignalHeaders();
      return this.setErrorStatus(
        roomConfig,
        rawHeaders,
        startedAt,
        new Error("Room signal servers are raw IP addresses; browser-direct signaling requires a domain entry"),
      );
    }

    let lastError: unknown;
    for (const signalServer of candidates) {
      const engine = this.createEngine();
      try {
        await engine.connect(signalServer, rawHeaders, roomConfig.timeout ?? 10_000);
        if (this.engine !== engine) {
          engine.close();
          return this.getStatus();
        }
        return this.setStatus(
          createSignalGatewayStatus({
            status: "connected",
            roomConfig,
            rawHeaders,
            startedAt,
            selectedSignalServer: signalServer,
            connectionId: engine.connectionId,
            strategy: DIRECT_SIGNAL_STRATEGY,
          }),
        );
      } catch (error) {
        if (this.engine === engine) this.engine = null;
        engine.close();
        lastError = error;
      }
    }

    await clearExtensionSignalHeaders();
    return this.setErrorStatus(roomConfig, rawHeaders, startedAt, lastError);
  }

  async stop(): Promise<RemoteSignalGatewayStatus> {
    this.closeEngine();
    await clearExtensionSignalHeaders();
    this.events = [];
    this.nextEventId = 1;
    return this.setStatus({
      ...createIdleSignalGatewayStatus(undefined, DIRECT_SIGNAL_STRATEGY),
      status: "closed",
      updatedAt: new Date().toISOString(),
    });
  }

  async sendControl(input: RemoteSignalControlRequest): Promise<RemoteSignalControlResult | null> {
    const engine = this.connectedEngine();
    if (!engine) return null;

    const emittedAt = new Date().toISOString();
    const payload = buildSignalGatewayControlPayload(input, browserSignalGatewayBinary);
    this.recordEvent({
      direction: "outbound",
      event: STREAMER_CONTROL_EVENT_NAME,
      payload: normalizeSignalGatewayPayload(payload, browserSignalGatewayBinary),
    });
    let ack: unknown[];
    try {
      ack = await engine.emitWithAck(STREAMER_CONTROL_EVENT_NAME, payload, STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS);
    } catch (error) {
      if (this.engine !== engine) return null;
      throw error;
    }
    if (this.engine !== engine) return null;
    const normalizedAck = normalizeSignalGatewayPayload(ack, browserSignalGatewayBinary);
    const ackArray = Array.isArray(normalizedAck) ? normalizedAck : [normalizedAck];
    const result: RemoteSignalControlResult = {
      event: STREAMER_CONTROL_EVENT_NAME,
      ackStatus: typeof ackArray[0] === "string" ? ackArray[0] : undefined,
      ack: ackArray,
      control: normalizeStreamerSignalControlAck(ackArray),
      emittedAt,
      ackReceivedAt: new Date().toISOString(),
    };
    this.recordEvent({ direction: "inbound", event: `${STREAMER_CONTROL_EVENT_NAME}:ack`, payload: result.ack });
    return result;
  }

  async sendSoac(input: RemoteSignalSoacRequest): Promise<RemoteSignalSoacResult | null> {
    const engine = this.connectedEngine();
    if (!engine) return null;

    const emittedAt = new Date().toISOString();
    const payload = await buildSignalGatewaySoacPayloadAsync(input, browserSignalGatewayBinary);
    if (this.engine !== engine) return null;
    this.recordEvent({
      direction: "outbound",
      event: STREAMER_SOAC_EVENT,
      payload: normalizeSignalGatewayPayload(payload, browserSignalGatewayBinary),
    });
    engine.emitWithOptionalAck(STREAMER_SOAC_EVENT, payload, (ack) => {
      if (this.engine !== engine) return;
      this.recordEvent({
        direction: "inbound",
        event: `${STREAMER_SOAC_EVENT}:ack`,
        payload: normalizeSignalGatewayPayload(ack, browserSignalGatewayBinary),
      });
    });
    return {
      event: STREAMER_SOAC_EVENT,
      payload: normalizeSignalGatewayPayload(payload, browserSignalGatewayBinary),
      emittedAt,
    };
  }

  private setErrorStatus(
    roomConfig: StreamerRoomConfig,
    rawHeaders: Record<string, string>,
    startedAt: string,
    error: unknown,
  ): RemoteSignalGatewayStatus {
    return this.setStatus(
      createSignalGatewayStatus({
        status: "error",
        roomConfig,
        rawHeaders,
        startedAt,
        strategy: DIRECT_SIGNAL_STRATEGY,
        error: redactSignalGatewayToken(errorMessage(error), roomConfig.token),
      }),
    );
  }

  private createEngine(): SignalSocketEngine {
    const engine = new SignalSocketEngine({
      callbacks: {
        onEvent: (event) => {
          if (this.engine === engine) this.recordEvent(event);
        },
        onClose: (reason) => {
          if (this.engine !== engine) return;
          this.engine = null;
          this.markSocketLost("closed", reason);
        },
        onError: (reason) => {
          if (this.engine !== engine) return;
          this.engine = null;
          this.markSocketLost("error", reason);
        },
      },
      codec: browserSignalGatewayBinary,
      openTransport: openBrowserSignalTransport,
      log: (message) => console.debug(`[uurc-direct] ${message}`),
    });
    this.engine = engine;
    return engine;
  }

  private markSocketLost(status: "closed" | "error", reason: string): void {
    const current = this.status;
    if (current.status !== "connected" && current.status !== "connecting") return;
    this.setStatus({
      ...current,
      status,
      connectionId: undefined,
      updatedAt: new Date().toISOString(),
      error: reason,
    });
  }

  private connectedEngine(): SignalSocketEngine | null {
    return this.status.status === "connected" && this.engine?.connected ? this.engine : null;
  }

  private closeEngine(): void {
    const engine = this.engine;
    this.engine = null;
    engine?.close();
  }

  private recordEvent(input: Omit<RemoteSignalGatewayEvent, "id" | "receivedAt">): void {
    this.events.push({ ...input, id: this.nextEventId, receivedAt: new Date().toISOString() });
    this.nextEventId += 1;
    if (this.events.length > SIGNAL_GATEWAY_MAX_EVENTS) {
      this.events = this.events.slice(-SIGNAL_GATEWAY_MAX_EVENTS);
    }
  }

  private pruneEvents(): void {
    const cutoff = Date.now() - SIGNAL_GATEWAY_EVENT_RETENTION_MS;
    const kept = this.events.filter((event) => Date.parse(event.receivedAt) >= cutoff);
    if (kept.length !== this.events.length) this.events = kept;
  }

  private setStatus(status: RemoteSignalGatewayStatus): RemoteSignalGatewayStatus {
    this.status = status;
    return status;
  }
}

// 扩展授权范围只覆盖信令域名;裸 IP 主机(如 wss://42.186.98.140/)无法注入 header
export function isDomainSignalServer(server: string): boolean {
  try {
    const host = new URL(server).hostname.replace(/^\[|\]$/g, "");
    return !/^[0-9a-fA-F:.]+$/.test(host);
  } catch {
    return false;
  }
}

function openBrowserSignalTransport({
  server,
  timeoutMs,
  signal,
}: OpenSignalTransportInput): Promise<SignalSocketTransport> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(buildBrowserEngineIoWebSocketUrl(server));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    socket.binaryType = "arraybuffer";

    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      closeQuietly(socket);
    }, timeoutMs);
    const onAbort = (): void => closeQuietly(socket);
    const onOpen = (): void => {
      cleanup();
      resolve(wrapBrowserWebSocket(socket));
    };
    const onError = (): void => {
      cleanup();
      reject(
        new Error(
          timedOut || signal.aborted
            ? `signal socket connect timed out after ${timeoutMs}ms`
            : "signal socket error during handshake",
        ),
      );
    };
    const onClose = (event: CloseEvent): void => {
      cleanup();
      reject(new Error(`signal socket closed during handshake code=${event.code} reason=${event.reason || "-"}`));
    };
    function cleanup(): void {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    }
    signal.addEventListener("abort", onAbort);
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function wrapBrowserWebSocket(socket: WebSocket): SignalSocketTransport {
  return {
    send: (frame) => socket.send(frame),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) =>
      socket.addEventListener("message", (event) => {
        listener(event.data);
      }),
    onClose: (listener) =>
      socket.addEventListener("close", (event) => {
        listener({ code: event.code, reason: event.reason });
      }),
    onError: (listener) => socket.addEventListener("error", () => listener()),
  };
}

function closeQuietly(socket: WebSocket): void {
  try {
    socket.close();
  } catch {
    // 已终止的 socket 无需再关闭
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
