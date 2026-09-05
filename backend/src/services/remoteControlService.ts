import {
  buildSignalGatewayControlPayload,
  buildSignalGatewaySoacPayload,
  normalizeSignalGatewayPayload,
} from "@uurc/shared/signalGateway/payload";
import {
  createIdleSignalGatewayStatus,
  createSignalGatewayStatus,
  orderSignalGatewayServers,
  redactSignalGatewayToken,
  SIGNAL_GATEWAY_EVENT_RETENTION_MS,
  SIGNAL_GATEWAY_MAX_EVENTS,
  SIGNAL_MAX_EVENT_BYTES,
} from "@uurc/shared/signalGateway/status";
import { normalizeSignalGatewayInboundEvents } from "@uurc/shared/signalGateway/events";
import type {
  RemoteSignalControlRequest,
  RemoteSignalControlResult,
  RemoteSignalGatewayEvent,
  RemoteSignalGatewayEventDirection,
  RemoteSignalGatewayStartRequest,
  RemoteSignalGatewayStatus,
  RemoteSignalSoacRequest,
  RemoteSignalSoacResult,
} from "@uurc/shared/signalGateway/model";
import { createRemoteControlBootstrap, type RemoteControlBootstrap } from "@uurc/shared/remoteBootstrap";
import { redact } from "@uurc/shared/redact";
import type { RemoteRoomJoinContext, RoomJoinUpstreamSummary } from "@uurc/shared/roomSession";
import { analyzeRemoteSignalReadiness, type RemoteSignalReadinessDiagnostics } from "@uurc/shared/streamer/readiness";
import {
  STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  STREAMER_CONTROL_EVENT_NAME,
  STREAMER_CONTROLLER_SIGNAL_EVENTS,
  STREAMER_SIGNAL_SOCKET_EVENTS,
  buildStreamerSignalHeaders,
} from "@uurc/shared/streamer/signalSession";
import { normalizeStreamerSignalControlAck } from "@uurc/shared/streamer/signalControl";
import { STREAMER_CONTROLLER_INBOUND_SOAC_TYPES, STREAMER_SOAC_EVENT } from "@uurc/shared/streamer/signalSoac";
import type { StreamerRoomConfig } from "@uurc/shared/roomConfig";

import { nodeSignalGatewayBinary } from "./nodeSignalGatewayBinaryCodec.js";
import { summarizeSignalEventForLog } from "./signalEventLog.js";
import type {
  SignalGatewayConnection,
  SignalGatewayConnectionStateUpdate,
  SignalGatewayConnector,
} from "./signalGateway.js";
import { SocketIoSignalGatewayConnector } from "./socketIoSignalGatewayConnector.js";

type RoomConfigSource = {
  getLatestRoomConfig(): Promise<StreamerRoomConfig | null>;
  getLatestJoinContext?(): Promise<RemoteRoomJoinContext | null>;
  clearByDevice?(input: { deviceId: string }): Promise<RoomJoinUpstreamSummary>;
};

export class RemoteControlService {
  private signalConnection: SignalGatewayConnection | null = null;
  private signalStatus: RemoteSignalGatewayStatus = createIdleSignalGatewayStatus();
  private signalEvents: RemoteSignalGatewayEvent[] = [];
  private nextSignalEventId = 1;
  private activeJoinContext: RemoteRoomJoinContext | null = null;
  private nextSignalRequestSequence = 0;
  private authoritativeSignalRequestSequence = 0;
  private activeSignalGeneration = 0;

  constructor(
    private readonly roomConfigSource?: RoomConfigSource,
    private readonly signalConnector: SignalGatewayConnector = new SocketIoSignalGatewayConnector(),
    private readonly sessionLogId = "standalone",
  ) {}

  async createBootstrap(): Promise<RemoteControlBootstrap | null> {
    const roomConfig = await this.roomConfigSource?.getLatestRoomConfig();
    if (!roomConfig) return null;

    const joinContext = await this.roomConfigSource?.getLatestJoinContext?.();
    return createRemoteControlBootstrap({ roomConfig, joinContext });
  }

  getSignalGatewayStatus(): RemoteSignalGatewayStatus {
    return this.signalStatus;
  }

  getSignalGatewayEvents(afterEventId = 0): RemoteSignalGatewayEvent[] {
    this.pruneSignalEvents();
    return this.signalEvents.filter((event) => event.id > afterEventId);
  }

  getSignalReadinessDiagnostics(): RemoteSignalReadinessDiagnostics {
    this.pruneSignalEvents();
    return analyzeRemoteSignalReadiness({
      events: this.signalEvents,
      signalStatus: this.signalStatus,
    });
  }

  async startSignalGateway(input: RemoteSignalGatewayStartRequest = {}): Promise<RemoteSignalGatewayStatus | null> {
    const requestSequence = ++this.nextSignalRequestSequence;
    const roomConfig = input.roomConfig ?? (await this.roomConfigSource?.getLatestRoomConfig());
    if (!roomConfig) return null;
    const joinContext = input.joinContext ?? (await this.roomConfigSource?.getLatestJoinContext?.()) ?? null;
    if (requestSequence < this.authoritativeSignalRequestSequence) return this.signalStatus;
    this.authoritativeSignalRequestSequence = requestSequence;
    const generation = ++this.activeSignalGeneration;
    this.activeJoinContext = joinContext;

    this.signalConnection?.close();
    this.signalConnection = null;
    this.signalEvents = [];
    this.nextSignalEventId = 1;

    const startedAt = new Date().toISOString();
    const rawHeaders = buildStreamerSignalHeaders({ token: roomConfig.token, gzipSdp: input.gzipSdp ?? true });
    this.signalStatus = createSignalGatewayStatus({
      status: "connecting",
      roomConfig,
      rawHeaders,
      startedAt,
    });
    this.logLifecycle("signal_start", generation, "connecting");

    let lastError: unknown;
    for (const signalServer of orderSignalGatewayServers(roomConfig.signalServers, input.signalServerIndex)) {
      try {
        const connection = await this.signalConnector.connect({
          signalServer,
          signalServers: roomConfig.signalServers,
          headers: rawHeaders,
          timeoutMs: roomConfig.timeout,
          reconnectDelayMs: roomConfig.signalReconnectDelay,
          inboundEvents: [
            ...STREAMER_CONTROLLER_SIGNAL_EVENTS,
            ...STREAMER_CONTROLLER_INBOUND_SOAC_TYPES,
            "switch_network_notify",
          ],
          socketEvents: STREAMER_SIGNAL_SOCKET_EVENTS,
          controlEvent: STREAMER_CONTROL_EVENT_NAME,
          onSignalEvent: (event, payload) => {
            if (generation !== this.activeSignalGeneration) return;
            for (const normalized of normalizeSignalGatewayInboundEvents(event, payload, nodeSignalGatewayBinary)) {
              this.recordSignalEvent({
                direction: "inbound",
                event: normalized.event,
                payload: normalized.payload,
              });
            }
          },
          onConnectionStateChange: (update) => {
            this.applyConnectionStateUpdate({
              generation,
              update,
              roomConfig,
              rawHeaders,
              startedAt,
              signalServer,
            });
          },
        });
        if (generation !== this.activeSignalGeneration) {
          connection.close();
          return this.signalStatus;
        }
        this.signalConnection = connection;
        this.signalStatus = createSignalGatewayStatus({
          status: "connected",
          roomConfig,
          rawHeaders,
          startedAt,
          connectionId: connection.id,
          selectedSignalServer: signalServer,
        });
        this.logLifecycle("signal_start", generation, "connected");
        return this.signalStatus;
      } catch (error) {
        if (generation !== this.activeSignalGeneration) return this.signalStatus;
        lastError = error;
      }
    }

    if (generation !== this.activeSignalGeneration) return this.signalStatus;
    this.signalStatus = createSignalGatewayStatus({
      status: "error",
      roomConfig,
      rawHeaders,
      startedAt,
      error: redactSignalGatewayToken(
        lastError instanceof Error ? lastError.message : String(lastError),
        roomConfig.token,
      ),
    });
    this.logLifecycle("signal_start", generation, "error", this.signalStatus.error);
    return this.signalStatus;
  }

  async sendSignalControl(input: RemoteSignalControlRequest): Promise<RemoteSignalControlResult | null> {
    const connection = this.signalConnection;
    const generation = this.activeSignalGeneration;
    if (!connection) return null;

    const emittedAt = new Date().toISOString();
    const payload = buildSignalGatewayControlPayload(input, nodeSignalGatewayBinary);
    this.recordSignalEvent({
      direction: "outbound",
      event: STREAMER_CONTROL_EVENT_NAME,
      payload,
    });
    let ack: unknown[];
    try {
      ack = await connection.emitWithAck(STREAMER_CONTROL_EVENT_NAME, payload, STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS);
    } catch (error) {
      if (!this.isCurrentSignalConnection(connection, generation)) return null;
      throw error;
    }
    if (!this.isCurrentSignalConnection(connection, generation)) return null;
    const normalizedAck = normalizeSignalGatewayPayload(ack, nodeSignalGatewayBinary);
    const ackStatus =
      Array.isArray(normalizedAck) && typeof normalizedAck[0] === "string" ? normalizedAck[0] : undefined;
    const result: RemoteSignalControlResult = {
      event: STREAMER_CONTROL_EVENT_NAME,
      ackStatus,
      ack: Array.isArray(normalizedAck) ? normalizedAck : [normalizedAck],
      control: normalizeStreamerSignalControlAck(normalizedAck),
      emittedAt,
      ackReceivedAt: new Date().toISOString(),
    };
    this.recordSignalEvent({
      direction: "inbound",
      event: `${STREAMER_CONTROL_EVENT_NAME}:ack`,
      payload: result.ack,
    });
    return result;
  }

  async sendSignalSoac(input: RemoteSignalSoacRequest): Promise<RemoteSignalSoacResult | null> {
    const connection = this.signalConnection;
    const generation = this.activeSignalGeneration;
    if (!connection) return null;

    const emittedAt = new Date().toISOString();
    const payload = buildSignalGatewaySoacPayload(input, nodeSignalGatewayBinary);
    this.recordSignalEvent({
      direction: "outbound",
      event: STREAMER_SOAC_EVENT,
      payload,
    });
    await connection.emitWithOptionalAck(STREAMER_SOAC_EVENT, payload, (ack) => {
      if (!this.isCurrentSignalConnection(connection, generation)) return;
      this.recordSignalEvent({
        direction: "inbound",
        event: `${STREAMER_SOAC_EVENT}:ack`,
        payload: ack,
      });
    });
    if (!this.isCurrentSignalConnection(connection, generation)) return null;
    return {
      event: STREAMER_SOAC_EVENT,
      payload: normalizeSignalGatewayPayload(payload, nodeSignalGatewayBinary),
      emittedAt,
    };
  }

  async stopSignalGateway(): Promise<RemoteSignalGatewayStatus> {
    const requestSequence = ++this.nextSignalRequestSequence;
    this.authoritativeSignalRequestSequence = requestSequence;
    const generation = ++this.activeSignalGeneration;
    const activeJoinContext = this.activeJoinContext;
    this.signalConnection?.close();
    this.signalConnection = null;
    this.activeJoinContext = null;

    this.signalStatus = {
      ...this.signalStatus,
      status: "closed",
      connectionId: undefined,
      roomClear: undefined,
      roomClearError: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.logLifecycle("signal_stop", generation, "closed");
    const joinContext = activeJoinContext ?? (await this.roomConfigSource?.getLatestJoinContext?.());
    if (generation !== this.activeSignalGeneration) return this.signalStatus;
    if (joinContext?.deviceId && this.roomConfigSource?.clearByDevice) {
      try {
        const roomClear = await this.roomConfigSource.clearByDevice({ deviceId: joinContext.deviceId });
        if (generation !== this.activeSignalGeneration) return this.signalStatus;
        this.signalStatus = {
          ...this.signalStatus,
          roomClear,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        if (generation !== this.activeSignalGeneration) return this.signalStatus;
        this.signalStatus = {
          ...this.signalStatus,
          roomClearError: String(redact(error instanceof Error ? error.message : error)),
          updatedAt: new Date().toISOString(),
        };
      }
    }
    return this.signalStatus;
  }

  private applyConnectionStateUpdate(input: {
    generation: number;
    update: SignalGatewayConnectionStateUpdate;
    roomConfig: StreamerRoomConfig;
    rawHeaders: Record<string, string>;
    startedAt: string;
    signalServer: string;
  }): void {
    if (input.generation !== this.activeSignalGeneration) return;

    if (input.update.status === "connected") {
      this.signalStatus = createSignalGatewayStatus({
        status: "connected",
        roomConfig: input.roomConfig,
        rawHeaders: input.rawHeaders,
        startedAt: input.startedAt,
        connectionId: input.update.connectionId,
        selectedSignalServer: input.signalServer,
      });
      return;
    }

    this.signalStatus = {
      ...this.signalStatus,
      status: input.update.status,
      connectionId: undefined,
      updatedAt: new Date().toISOString(),
      error: input.update.reason ? redactSignalGatewayToken(input.update.reason, input.roomConfig.token) : undefined,
    };
    if (input.update.status === "closed" || input.update.status === "error") {
      this.signalConnection = null;
    }
    this.logLifecycle("signal_connection_state", input.generation, input.update.status, this.signalStatus.error);
  }

  private isCurrentSignalConnection(connection: SignalGatewayConnection, generation: number): boolean {
    return generation === this.activeSignalGeneration && connection === this.signalConnection;
  }

  private logLifecycle(event: string, generation: number, status: string, reason?: string): void {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: status === "error" ? "error" : "info",
        event,
        remoteSession: this.sessionLogId,
        generation,
        status,
        reason,
      }),
    );
  }

  private recordSignalEvent(input: {
    direction: RemoteSignalGatewayEventDirection;
    event: string;
    payload: unknown;
  }): RemoteSignalGatewayEvent {
    const record: RemoteSignalGatewayEvent = {
      id: this.nextSignalEventId++,
      direction: input.direction,
      event: input.event,
      receivedAt: new Date().toISOString(),
      payload: normalizeSignalGatewayPayload(input.payload, nodeSignalGatewayBinary),
    };
    this.signalEvents = [...this.signalEvents, record]
      .filter((event) => Date.parse(event.receivedAt) >= Date.now() - SIGNAL_GATEWAY_EVENT_RETENTION_MS)
      .slice(-SIGNAL_GATEWAY_MAX_EVENTS);
    let retainedBytes = 0;
    let startIndex = this.signalEvents.length;
    while (startIndex > 0) {
      retainedBytes += Buffer.byteLength(JSON.stringify(this.signalEvents[startIndex - 1]));
      if (retainedBytes > SIGNAL_MAX_EVENT_BYTES) break;
      startIndex -= 1;
    }
    this.signalEvents = this.signalEvents.slice(startIndex);
    console.log(`signal event ${summarizeSignalEventForLog(record)}`);
    return record;
  }

  private pruneSignalEvents(): void {
    const cutoff = Date.now() - SIGNAL_GATEWAY_EVENT_RETENTION_MS;
    this.signalEvents = this.signalEvents.filter((event) => Date.parse(event.receivedAt) >= cutoff);
  }
}
