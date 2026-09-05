import { DurableObject } from "cloudflare:workers";
import {
  isAuthorizedSignalRoom,
  REMOTE_SESSION_IDLE_MS,
  type SignalRoomAuthorization,
} from "@uurc/shared/signalGateway/authorization";
import { analyzeRemoteSignalReadiness } from "@uurc/shared/streamer/readiness";
import {
  STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS,
  STREAMER_CONTROL_EVENT_NAME,
  buildStreamerSignalHeaders,
} from "@uurc/shared/streamer/signalSession";
import { normalizeStreamerSignalControlAck } from "@uurc/shared/streamer/signalControl";
import { STREAMER_SOAC_EVENT } from "@uurc/shared/streamer/signalSoac";
import {
  buildSignalGatewayControlPayload,
  buildSignalGatewaySoacPayloadAsync,
  normalizeSignalGatewayPayload,
} from "@uurc/shared/signalGateway/payload";
import {
  createIdleSignalGatewayStatus,
  createSignalGatewayStatus,
  orderSignalGatewayServers,
  redactSignalGatewayToken,
} from "@uurc/shared/signalGateway/status";
import { normalizeSignalGatewayRoomConfig } from "@uurc/shared/signalGateway/events";
import type {
  RemoteSignalControlRequest,
  RemoteSignalControlResult,
  RemoteSignalGatewayEvent,
  RemoteSignalGatewayStartRequest,
  RemoteSignalGatewayStatus,
  RemoteSignalSoacRequest,
  RemoteSignalSoacResult,
} from "@uurc/shared/signalGateway/model";

import { SignalSessionStore } from "./signal/signalSessionStore.js";
import { workerSignalGatewayBinary } from "./signal/workerSignalBinaryCodec.js";
import { WorkerSignalSocket } from "./signal/workerSignalSocket.js";

type SignalSessionEnv = Record<string, never>;

export class RemoteSignalSession extends DurableObject<SignalSessionEnv> {
  private readonly store: SignalSessionStore;
  private signalSocket: WorkerSignalSocket | null = null;
  private status: RemoteSignalGatewayStatus | null = null;
  private rawHeaders: Record<string, string> = {};
  private nextSignalRequestSequence = 0;
  private authoritativeSignalRequestSequence = 0;
  private activeSignalGeneration = 0;
  private clientExpiresAt = 0;

  constructor(ctx: DurableObjectState, env: SignalSessionEnv) {
    super(ctx, env);
    this.store = new SignalSessionStore(ctx.storage.sql);
    this.ctx.blockConcurrencyWhile(async () => {
      this.store.initialize();
      this.status = this.store.readStatus() ?? createIdleSignalGatewayStatus();
      if (!this.store.readStatus()) this.store.writeStatus(this.status);
      this.clientExpiresAt = (await ctx.storage.get<number>("clientExpiresAt")) ?? 0;
    });
  }

  async getStatus(): Promise<RemoteSignalGatewayStatus> {
    await this.renewClientLease();
    const status = this.readStatus();
    if (status.status === "connected" && !this.signalSocket?.connected) {
      return this.setStatus({
        ...status,
        status: "closed",
        connectionId: undefined,
        updatedAt: new Date().toISOString(),
        error: "Worker instance has no active upstream signal socket; restart the signal gateway.",
      });
    }
    return status;
  }

  async getEvents(afterEventId = 0): Promise<RemoteSignalGatewayEvent[]> {
    await this.renewClientLease();
    return this.store.readEvents(afterEventId);
  }

  async getDiagnostics() {
    return analyzeRemoteSignalReadiness({
      events: this.store.readEvents(),
      signalStatus: await this.getStatus(),
    });
  }

  async start(input: RemoteSignalGatewayStartRequest = {}): Promise<RemoteSignalGatewayStatus> {
    const requestSequence = ++this.nextSignalRequestSequence;
    const authorization = await this.ctx.storage.get<SignalRoomAuthorization>("roomAuthorization");
    if (!isAuthorizedSignalRoom(authorization, input.roomConfig)) {
      return {
        ...createIdleSignalGatewayStatus(),
        status: "error",
        error: "Join the room through this gateway before starting its signal connection",
      };
    }
    const roomConfig = normalizeSignalGatewayRoomConfig(input.roomConfig);
    if (!roomConfig) {
      return {
        ...createIdleSignalGatewayStatus(),
        status: "error",
        updatedAt: new Date().toISOString(),
        error: "roomConfig with token and signalServers is required",
      };
    }

    if (requestSequence < this.authoritativeSignalRequestSequence) return this.readStatus();
    await this.renewClientLease();
    if (requestSequence < this.authoritativeSignalRequestSequence) return this.readStatus();
    this.authoritativeSignalRequestSequence = requestSequence;
    const generation = ++this.activeSignalGeneration;
    this.closeSocket();
    this.store.clearEvents();

    const startedAt = new Date().toISOString();
    this.rawHeaders = buildStreamerSignalHeaders({ token: roomConfig.token, gzipSdp: input.gzipSdp ?? true });
    this.setStatus(
      createSignalGatewayStatus({
        status: "connecting",
        roomConfig,
        rawHeaders: this.rawHeaders,
        startedAt,
      }),
    );

    let lastError: unknown;
    for (const signalServer of orderSignalGatewayServers(roomConfig.signalServers, input.signalServerIndex)) {
      const socket = this.createSignalSocket(generation);
      this.signalSocket = socket;
      try {
        await socket.connect(signalServer, this.rawHeaders, roomConfig.timeout ?? 10_000);
        if (!this.isCurrentSocket(socket, generation)) {
          socket.close();
          return this.readStatus();
        }
        return this.setStatus(
          createSignalGatewayStatus({
            status: "connected",
            roomConfig,
            rawHeaders: this.rawHeaders,
            startedAt,
            selectedSignalServer: signalServer,
            connectionId: socket.connectionId,
          }),
        );
      } catch (error) {
        if (this.signalSocket === socket) this.signalSocket = null;
        socket.close();
        if (generation !== this.activeSignalGeneration) return this.readStatus();
        lastError = error;
      }
    }

    return this.setStatus(
      createSignalGatewayStatus({
        status: "error",
        roomConfig,
        rawHeaders: this.rawHeaders,
        startedAt,
        error: redactSignalGatewayToken(errorMessage(lastError), roomConfig.token),
      }),
    );
  }

  async stop(): Promise<RemoteSignalGatewayStatus> {
    const requestSequence = ++this.nextSignalRequestSequence;
    this.authoritativeSignalRequestSequence = requestSequence;
    ++this.activeSignalGeneration;
    this.closeSocket();
    this.store.clearEvents();
    this.rawHeaders = {};
    this.clientExpiresAt = 0;
    const status = this.setStatus({
      ...createIdleSignalGatewayStatus(),
      status: "closed",
      updatedAt: new Date().toISOString(),
    });
    await this.ctx.storage.delete(["roomAuthorization", "clientExpiresAt"]);
    await this.ctx.storage.deleteAlarm();
    return status;
  }

  async authorizeRoom(authorization: SignalRoomAuthorization): Promise<void> {
    await this.ctx.storage.put("roomAuthorization", authorization);
    this.clientExpiresAt = Date.now() + REMOTE_SESSION_IDLE_MS;
    await this.renewClientLease();
  }

  async alarm(): Promise<void> {
    if (this.clientExpiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(this.clientExpiresAt);
      return;
    }
    await this.stop();
  }

  private async renewClientLease(): Promise<void> {
    this.store.pruneEvents();
    if (!this.clientExpiresAt) return;
    if (this.clientExpiresAt <= Date.now()) {
      await this.stop();
      return;
    }
    this.clientExpiresAt = Date.now() + REMOTE_SESSION_IDLE_MS;
    await this.ctx.storage.put("clientExpiresAt", this.clientExpiresAt);
    await this.ctx.storage.setAlarm(this.clientExpiresAt);
  }

  async sendControl(input: RemoteSignalControlRequest): Promise<RemoteSignalControlResult | null> {
    await this.renewClientLease();
    const socket = this.connectedSocket();
    const generation = this.activeSignalGeneration;
    if (!socket) return null;

    const emittedAt = new Date().toISOString();
    const payload = buildSignalGatewayControlPayload(input, workerSignalGatewayBinary);
    this.recordEvent({
      direction: "outbound",
      event: STREAMER_CONTROL_EVENT_NAME,
      payload: normalizeSignalGatewayPayload(payload, workerSignalGatewayBinary),
    });
    let ack: unknown[];
    try {
      ack = await socket.emitWithAck(STREAMER_CONTROL_EVENT_NAME, payload, STREAMER_CONTROL_EVENT_ACK_TIMEOUT_MS);
    } catch (error) {
      if (!this.isCurrentSocket(socket, generation)) return null;
      throw error;
    }
    if (!this.isCurrentSocket(socket, generation)) return null;
    const normalizedAck = normalizeSignalGatewayPayload(ack, workerSignalGatewayBinary);
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
    await this.renewClientLease();
    const socket = this.connectedSocket();
    const generation = this.activeSignalGeneration;
    if (!socket) return null;

    const emittedAt = new Date().toISOString();
    const payload = await buildSignalGatewaySoacPayloadAsync(input, workerSignalGatewayBinary);
    if (!this.isCurrentSocket(socket, generation)) return null;
    this.recordEvent({
      direction: "outbound",
      event: STREAMER_SOAC_EVENT,
      payload: normalizeSignalGatewayPayload(payload, workerSignalGatewayBinary),
    });
    socket.emitWithOptionalAck(STREAMER_SOAC_EVENT, payload, (ack) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      this.recordEvent({
        direction: "inbound",
        event: `${STREAMER_SOAC_EVENT}:ack`,
        payload: normalizeSignalGatewayPayload(ack, workerSignalGatewayBinary),
      });
    });
    return {
      event: STREAMER_SOAC_EVENT,
      payload: normalizeSignalGatewayPayload(payload, workerSignalGatewayBinary),
      emittedAt,
    };
  }

  private createSignalSocket(generation: number): WorkerSignalSocket {
    const socket = new WorkerSignalSocket({
      onEvent: (event) => {
        if (this.isCurrentSocket(socket, generation)) this.recordEvent(event);
      },
      onClose: (reason) => {
        if (!this.isCurrentSocket(socket, generation)) return;
        this.signalSocket = null;
        const status = this.readStatus();
        if (status.status === "connected" || status.status === "connecting") {
          this.setStatus({
            ...status,
            status: "closed",
            connectionId: undefined,
            updatedAt: new Date().toISOString(),
            error: reason,
          });
        }
      },
      onError: (reason) => {
        if (!this.isCurrentSocket(socket, generation)) return;
        this.signalSocket = null;
        const status = this.readStatus();
        if (status.status === "connected" || status.status === "connecting") {
          this.setStatus({ ...status, status: "error", updatedAt: new Date().toISOString(), error: reason });
        }
      },
    });
    return socket;
  }

  private isCurrentSocket(socket: WorkerSignalSocket, generation: number): boolean {
    return generation === this.activeSignalGeneration && socket === this.signalSocket;
  }

  private connectedSocket(): WorkerSignalSocket | null {
    return this.readStatus().status === "connected" && this.signalSocket?.connected ? this.signalSocket : null;
  }

  private closeSocket(): void {
    const socket = this.signalSocket;
    this.signalSocket = null;
    socket?.close();
  }

  private readStatus(): RemoteSignalGatewayStatus {
    return this.status ?? this.store.readStatus() ?? createIdleSignalGatewayStatus();
  }

  private setStatus(status: RemoteSignalGatewayStatus): RemoteSignalGatewayStatus {
    this.status = status;
    this.store.writeStatus(status);
    return status;
  }

  private recordEvent(input: Omit<RemoteSignalGatewayEvent, "id" | "receivedAt">): void {
    this.store.recordEvent(input);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
